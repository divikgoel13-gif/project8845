"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { STORAGE_BUCKETS, buildStoragePath } from "@/lib/storage/buckets";
import { rupeesToPaise } from "@/lib/money";
import { recordAuditEvent } from "@/lib/audit/log";

/**
 * Manual disbursement (SRS Phase 6: "Manual disbursement queue in Super
 * Admin — select vendor → see available → enter amount → mark disbursed +
 * upload proof," "Partial disbursement," "Payout duplicate protection,"
 * "Admin cannot over-disburse without an audited override").
 *
 * Super-Admin only. Takes FormData because it carries a proof file upload.
 *
 * Allocation: the entered amount is applied to this restaurant's OUTSTANDING
 * vendor_payables oldest-first, each row's `disbursed_amount_paise` bumped by
 * an optimistic-concurrency update (`.eq("disbursed_amount_paise", seen)`),
 * so two racing disbursements can never double-spend the same payable — that
 * ledger IS the "payout duplicate protection" the SRS requires. The
 * per-payable CHECK (disbursed <= amount) is never violated: an override
 * that exceeds total outstanding settles every payable in full and records
 * the excess only on the `disbursements` row, with a mandatory audited
 * reason. Proof upload is mandatory (disbursements.proof_path is NOT NULL)
 * and lands in the PRIVATE payout-proofs bucket under
 * "restaurant/<id>/..." so the storage RLS in 0015 can scope vendor reads.
 */

const MetaSchema = z.object({
  restaurantId: z.string().uuid(),
  amountRupees: z.number().positive("Enter an amount greater than zero."),
  reference: z.string().trim().max(200).optional(),
  override: z.boolean(),
  overrideReason: z.string().trim().max(500).optional(),
});

export async function disburseToVendor(formData: FormData) {
  const profile = await requireSuperAdmin();

  const parsed = MetaSchema.parse({
    restaurantId: String(formData.get("restaurantId") ?? ""),
    amountRupees: Number(formData.get("amountRupees")),
    reference: (formData.get("reference") as string) || undefined,
    override: formData.get("override") === "true",
    overrideReason: (formData.get("overrideReason") as string) || undefined,
  });

  const proof = formData.get("proof");
  if (!(proof instanceof File) || proof.size === 0) {
    throw new Error("A payout proof file is required.");
  }
  if (proof.size > 10 * 1024 * 1024) {
    throw new Error("Proof file must be 10MB or smaller.");
  }

  const amountPaise = rupeesToPaise(parsed.amountRupees);
  if (amountPaise <= 0) throw new Error("Enter an amount greater than zero.");

  const supabase = createServiceRoleSupabaseClient();

  // Outstanding payables, oldest-first — the allocation target set.
  const { data: payables } = await supabase
    .from("vendor_payables")
    .select("id, order_id, amount_paise, disbursed_amount_paise")
    .eq("restaurant_id", parsed.restaurantId)
    .order("created_at", { ascending: true });

  const outstanding = (payables ?? [])
    .map((p) => ({ ...p, remaining: p.amount_paise - p.disbursed_amount_paise }))
    .filter((p) => p.remaining > 0);

  const totalOutstanding = outstanding.reduce((sum, p) => sum + p.remaining, 0);

  if (totalOutstanding === 0 && !parsed.override) {
    throw new Error("This restaurant has no outstanding payable to disburse.");
  }

  // Over-disbursement guard (SRS completion standard: "admin cannot
  // over-disburse without an audited override").
  if (amountPaise > totalOutstanding) {
    if (!parsed.override) {
      throw new Error(
        `Amount exceeds the outstanding payable. Reduce it, or confirm an override with a reason.`
      );
    }
    if (!parsed.overrideReason) {
      throw new Error("An override reason is required to disburse more than the outstanding payable.");
    }
  }

  // Upload proof BEFORE mutating any ledger row — a failed upload must not
  // leave a half-allocated payable. Path segment [2] = restaurantId so the
  // 0015 storage RLS (payout_proofs_read_scoped) scopes vendor reads.
  const path = buildStoragePath("restaurant", parsed.restaurantId, proof.name || "proof");
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKETS.payoutProofs)
    .upload(path, proof, { contentType: proof.type || "application/octet-stream", upsert: false });
  if (uploadError) throw new Error(`Could not upload proof: ${uploadError.message}`);

  // Allocate oldest-first with optimistic concurrency per payable.
  const covers: Array<{ payableId: string; orderId: string; amountPaise: number }> = [];
  let remaining = amountPaise;

  for (const p of outstanding) {
    if (remaining <= 0) break;
    const alloc = Math.min(remaining, p.remaining);
    const { data: updated, error: updErr } = await supabase
      .from("vendor_payables")
      .update({ disbursed_amount_paise: p.disbursed_amount_paise + alloc })
      .eq("id", p.id)
      .eq("disbursed_amount_paise", p.disbursed_amount_paise)
      .select("id");

    if (updErr) throw new Error(updErr.message);
    if (!updated || updated.length === 0) {
      // Someone else disbursed against this payable between our read and
      // write — abort rather than risk double-spending. Proof object is
      // left in storage (harmless, unreferenced) and can be cleaned up.
      throw new Error("This restaurant's balance just changed — reload and try again.");
    }

    covers.push({ payableId: p.id, orderId: p.order_id, amountPaise: alloc });
    remaining -= alloc;
  }

  const { data: disbursement, error: insErr } = await supabase
    .from("disbursements")
    .insert({
      restaurant_id: parsed.restaurantId,
      admin_id: profile.id,
      amount_paise: amountPaise,
      covers,
      proof_path: path,
      reference: parsed.reference ?? null,
      status: "paid",
    })
    .select("id")
    .single();

  if (insErr || !disbursement) throw new Error(insErr?.message ?? "Could not record the disbursement.");

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "super_admin",
    action: parsed.override && amountPaise > totalOutstanding ? "disbursement.created_override" : "disbursement.created",
    targetTable: "disbursements",
    targetId: disbursement.id,
    restaurantId: parsed.restaurantId,
    after: {
      amountPaise,
      totalOutstandingBefore: totalOutstanding,
      allocatedPaise: amountPaise - remaining,
      coversOrderCount: covers.length,
      reference: parsed.reference ?? null,
    },
    reason: parsed.override && amountPaise > totalOutstanding ? parsed.overrideReason : undefined,
  });

  revalidatePath("/admin/payments");
  revalidatePath(`/admin/payments/${parsed.restaurantId}`);
  return { disbursementId: disbursement.id };
}
