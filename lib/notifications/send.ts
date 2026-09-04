import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getSmsProvider } from "@/lib/notifications/sms";
import type { Json } from "@/types/database";

/**
 * V1 SMS event templates (SRS V2 §E.2). Only a subset is wired up by
 * Phase 3 — order_paid (this phase's own concern). Pickup reminders,
 * ready-for-pickup, cancellation, refund, and grievance-update
 * notifications get wired in their respective phases (5, 6, 8) using this
 * same function.
 */
export type NotificationTemplate = "otp" | "order_paid" | "pickup_reminder" | "order_ready" | "restaurant_cancellation" | "refund_update" | "grievance_update";

/**
 * Sends a notification via the active SMS provider and records it in
 * `notifications` regardless of outcome (SRS §3: observability includes
 * notification delivery state). Deliberately does NOT throw on failure —
 * a notification is important but must never be allowed to unwind a
 * successful business transaction (payment confirmation, order state
 * change) that triggered it. Callers that care about the outcome can
 * inspect the return value; callers that don't (most of them) can
 * fire-and-forget with a try/catch, as lib/orders/finalize-payment.ts does.
 *
 * `dedupeKey`, when provided, identifies a specific at-most-once business
 * event (e.g. `order_paid:<paymentId>`) and is enforced by a unique DB
 * index (0023_phase10_security_audit_fixes.sql) — see PHASE_10_SECURITY_AUDIT
 * §10.11. This function does not depend on any particular caller already
 * being idempotent before it's reached: if a caller races or retries with
 * the same key, only the first insert lands and this call resolves
 * silently rather than double-sending. Pass a dedupeKey for any event that
 * has a natural at-most-once identity; omit it only for genuinely
 * repeatable/ad hoc notifications.
 */
export async function sendNotification(
  userId: string,
  template: NotificationTemplate,
  payload: Record<string, unknown>,
  dedupeKey?: string
): Promise<void> {
  const supabase = createServiceRoleSupabaseClient();

  if (dedupeKey) {
    const { data: existing } = await supabase
      .from("notifications")
      .select("id")
      .eq("dedupe_key", dedupeKey)
      .maybeSingle();
    if (existing) return; // already sent (or already attempted) for this event
  }

  const { data: profile } = await supabase.from("profiles").select("phone").eq("id", userId).single();

  const insertRow = async (fields: Record<string, unknown>) => {
    const { error } = await supabase.from("notifications").insert({
      user_id: userId,
      channel: "sms",
      template,
      // payload arrives as Record<string, unknown> from callers; a JSON
      // round-trip both satisfies the jsonb column's Json type and matches
      // exactly what Postgres will actually store.
      payload: JSON.parse(JSON.stringify(payload)) as Json,
      dedupe_key: dedupeKey ?? null,
      ...fields,
    });
    // A unique violation on dedupe_key means a concurrent call already won
    // the race for this event — that's success, not failure, from this
    // caller's point of view, so it's swallowed rather than surfaced.
    if (error && error.code !== "23505") throw new Error(error.message);
  };

  if (!profile?.phone) {
    await insertRow({ status: "failed" });
    return;
  }

  const provider = getSmsProvider();
  const result = await provider.send({
    toPhone: profile.phone,
    templateId: template,
    variables: stringifyPayload(payload),
  });

  await insertRow({
    status: result.status === "sent" ? "sent" : "failed",
    provider_message_id: result.providerMessageId,
  });
}

function stringifyPayload(payload: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload)) {
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}
