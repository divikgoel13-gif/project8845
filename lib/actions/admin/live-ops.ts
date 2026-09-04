"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";
import { ALERT_TYPES, type AlertType } from "@/lib/admin/live-ops";

/**
 * Acknowledging and un-acknowledging live operational alerts (SRS V2 §F.1:
 * "Operational alerts must be auditable when acknowledged/resolved").
 *
 * The design question §F.1 forces is what an acknowledgement actually means.
 * The answer taken here: an ack records that a named human has SEEN a specific
 * alert at a specific time, and nothing more. It does not resolve the
 * underlying condition, does not remove the alert from the page, and does not
 * touch the order/restaurant/payout it points at. An overdue pickup that has
 * been acknowledged is still an overdue pickup; the ack only tells the next
 * operator "someone is on this, and here is their note", which is exactly the
 * hand-off problem a shared command center has.
 *
 * Two structural consequences:
 *
 *  - Acks are their own table (`operational_alert_acks`), not a column on
 *    orders. Alerts are DERIVED — an order becomes "overdue" by the passage of
 *    time, not by a write — so there is no row to flag, and eleven nullable
 *    acked_at columns spread across six tables would be the alternative.
 *
 *  - Clearing is a soft clear (`cleared_at`/`cleared_by`), never a delete. §P
 *    forbids destroying operational history, and "who acknowledged this and who
 *    later took it back" is precisely the trail an incident review needs. The
 *    partial unique index `uq_operational_alert_ack_active` allows exactly one
 *    ACTIVE ack per (alert_type, target_id) while permitting any number of
 *    historical cleared ones.
 *
 * Both actions write through the service role because they insert on behalf of
 * the admin with a foreign key to their profile, and both call
 * `requireSuperAdmin()` first — no other role reaches the command center.
 */

const ALERT_TYPE_VALUES = Object.values(ALERT_TYPES) as [AlertType, ...AlertType[]];

const AcknowledgeSchema = z.object({
  /**
   * Constrained to the known alert types rather than free text. `alert_type` is
   * a plain text column, and a typo'd type would create an ack that the page
   * can never match back to its alert — an acknowledgement that silently does
   * nothing is worse than a rejected one.
   */
  alertType: z.enum(ALERT_TYPE_VALUES),
  targetTable: z.string().trim().min(1).max(64),
  targetId: z.string().uuid(),
  restaurantId: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(1_000).optional(),
});

export type AcknowledgeAlertInput = z.infer<typeof AcknowledgeSchema>;

export async function acknowledgeAlert(input: AcknowledgeAlertInput) {
  const admin = await requireSuperAdmin();
  const parsed = AcknowledgeSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  // Re-acknowledging an already-acknowledged alert is a no-op rather than an
  // error. Two operators opening the command center at the same moment is the
  // normal case, and the second one should not see a unique-violation stack
  // trace for pressing a button that was already pressed.
  const { data: existing } = await supabase
    .from("operational_alert_acks")
    .select("id, acknowledged_by, note, created_at")
    .eq("alert_type", parsed.alertType)
    .eq("target_id", parsed.targetId)
    .is("cleared_at", null)
    .maybeSingle();

  if (existing) return { id: existing.id, alreadyAcknowledged: true };

  const { data: inserted, error } = await supabase
    .from("operational_alert_acks")
    .insert({
      alert_type: parsed.alertType,
      target_table: parsed.targetTable,
      target_id: parsed.targetId,
      restaurant_id: parsed.restaurantId ?? null,
      acknowledged_by: admin.id,
      note: parsed.note?.length ? parsed.note : null,
    })
    .select("id, created_at")
    .single();

  if (error) throw new Error(`Could not acknowledge alert: ${error.message}`);

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: "super_admin",
    action: "operational_alert.acknowledged",
    targetTable: "operational_alert_acks",
    targetId: inserted.id,
    restaurantId: parsed.restaurantId ?? undefined,
    after: {
      alert_type: parsed.alertType,
      target_table: parsed.targetTable,
      target_id: parsed.targetId,
      note: parsed.note ?? null,
    },
    reason: parsed.note?.length ? parsed.note : undefined,
  });

  revalidatePath("/admin/operations");
  revalidatePath("/admin/dashboard");
  return { id: inserted.id, alreadyAcknowledged: false };
}

const ClearSchema = z.object({
  alertType: z.enum(ALERT_TYPE_VALUES),
  targetId: z.string().uuid(),
});

/**
 * Withdraws an acknowledgement — "I thought I had this, I do not".
 *
 * Named `clear` rather than `resolve` on purpose: resolving the underlying
 * condition happens on the order/restaurant/payout itself, and calling this
 * "resolve" would invite an operator to clear the ack and believe the problem
 * had been dealt with.
 */
export async function clearAlertAcknowledgement(input: z.infer<typeof ClearSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = ClearSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: before } = await supabase
    .from("operational_alert_acks")
    .select("id, alert_type, target_table, target_id, restaurant_id, acknowledged_by, note, created_at")
    .eq("alert_type", parsed.alertType)
    .eq("target_id", parsed.targetId)
    .is("cleared_at", null)
    .maybeSingle();

  if (!before) return { cleared: false };

  const { error } = await supabase
    .from("operational_alert_acks")
    .update({ cleared_at: new Date().toISOString(), cleared_by: admin.id })
    .eq("id", before.id);

  if (error) throw new Error(`Could not clear acknowledgement: ${error.message}`);

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: "super_admin",
    action: "operational_alert.ack_cleared",
    targetTable: "operational_alert_acks",
    targetId: before.id,
    restaurantId: before.restaurant_id ?? undefined,
    before,
    after: { cleared_by: admin.id },
  });

  revalidatePath("/admin/operations");
  revalidatePath("/admin/dashboard");
  return { cleared: true };
}
