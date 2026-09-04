"use server";

import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";

/**
 * Reference implementation for "Super Admin must be able to view the
 * current commission rate, change it through an explicit controlled
 * action, and see who changed it, when, the previous value, the new
 * value and the reason in the audit log" (SRS §11.5).
 *
 * The full Commission Configuration screen under Platform Settings is a
 * Phase 9 deliverable — this action is written now, alongside the schema,
 * so Phase 9 wires a form to an already-correct, already-audited mutation
 * rather than inventing the pattern later.
 *
 * Critically: this does NOT touch orders.commission_rate_snapshot on any
 * existing order. That snapshot is written once, at order-creation time
 * (Phase 3), and is immutable afterward — see SRS §23: "Changing the
 * commission setting does not retroactively alter historical orders."
 */
const UpdateCommissionRateSchema = z.object({
  newRate: z.number().min(0).max(1), // fraction, e.g. 0.08 for 8%
  reason: z.string().trim().min(1, "A reason is required for the audit log."),
});

export async function updateCommissionRate(input: { newRate: number; reason: string }) {
  const admin = await requireSuperAdmin();
  const parsed = UpdateCommissionRateSchema.parse(input);

  const supabase = createServiceRoleSupabaseClient();

  const { data: current, error: readError } = await supabase
    .from("admin_settings")
    .select("value")
    .eq("key", "commission_rate")
    .single();

  if (readError) {
    throw new Error(`Could not read current commission rate: ${readError.message}`);
  }

  const { error: writeError } = await supabase
    .from("admin_settings")
    .update({
      value: parsed.newRate,
      updated_by: admin.id,
      updated_at: new Date().toISOString(),
    })
    .eq("key", "commission_rate");

  if (writeError) {
    throw new Error(`Could not update commission rate: ${writeError.message}`);
  }

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: "super_admin",
    action: "commission_rate.updated",
    targetTable: "admin_settings",
    targetId: "commission_rate",
    before: current.value,
    after: parsed.newRate,
    reason: parsed.reason,
  });

  return { previousRate: current.value, newRate: parsed.newRate };
}
