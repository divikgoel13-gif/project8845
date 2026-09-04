"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";
import { runReconciliationScan } from "@/lib/admin/reconciliation";

/**
 * SRS V2 §T: "Resolution is manual and auditable in V1." Both actions here
 * touch ONLY `financial_reconciliation_items` — see
 * lib/admin/reconciliation.ts's header for why that boundary is load-bearing,
 * not incidental. Neither action ever writes to orders, payments,
 * disbursements or vendor_payables.
 */

export async function triggerReconciliationScan() {
  const admin = await requireSuperAdmin();

  let result;
  try {
    result = await runReconciliationScan();
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "The scan could not complete." };
  }

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: "reconciliation_item.scan_run",
    targetTable: "financial_reconciliation_items",
    after: { candidateCount: result.candidateCount, byType: result.byType },
  });

  revalidatePath("/admin/payments/reconciliation");
  return { ok: true as const, result };
}

const STATUS_TRANSITIONS = ["investigating", "resolved", "ignored"] as const;

const UpdateItemSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(STATUS_TRANSITIONS),
  note: z.string().trim().max(1000).nullable(),
});

export async function updateReconciliationItemStatus(input: z.input<typeof UpdateItemSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = UpdateItemSchema.parse(input);

  if ((parsed.status === "resolved" || parsed.status === "ignored") && !parsed.note) {
    return { ok: false as const, error: "A note is required to resolve or ignore an item." };
  }

  const supabase = createServiceRoleSupabaseClient();

  const { data: current } = await supabase
    .from("financial_reconciliation_items")
    .select("status, resolution_note, item_type")
    .eq("id", parsed.id)
    .maybeSingle();
  if (!current) return { ok: false as const, error: "This item no longer exists." };

  const isTerminal = parsed.status === "resolved" || parsed.status === "ignored";
  const { error } = await supabase
    .from("financial_reconciliation_items")
    .update({
      status: parsed.status,
      resolved_by: admin.id,
      resolution_note: parsed.note,
      resolved_at: isTerminal ? new Date().toISOString() : null,
    })
    .eq("id", parsed.id);

  if (error) return { ok: false as const, error: error.message };

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: `reconciliation_item.${parsed.status}`,
    targetTable: "financial_reconciliation_items",
    targetId: parsed.id,
    before: { status: current.status, resolutionNote: current.resolution_note },
    after: { status: parsed.status, resolutionNote: parsed.note },
    reason: parsed.note ?? undefined,
  });

  revalidatePath("/admin/payments/reconciliation");
  return { ok: true as const };
}
