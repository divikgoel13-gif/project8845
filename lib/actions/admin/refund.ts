"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { rupeesToPaise } from "@/lib/money";
import { recordAuditEvent } from "@/lib/audit/log";

/**
 * Manual refund recording (SRS §V Phase 6: "Manual refund support"; SRS V2
 * §C.3: "refunds are always manual, via a grievance"). V1 has no automated
 * Razorpay refund path — a refund is a real-world bank/UPI action the Super
 * Admin performs, then RECORDS here against the originating grievance. This
 * writes an audited `refund_events` ledger row (financial truth, service-
 * role-only per 0006_rls_policies.sql) and an internal grievance event; it
 * deliberately does NOT overwrite the original sale/commission figures
 * (SRS V2 §C: "must not overwrite the original sale"), exactly like the
 * restaurant_cancellation_events ledger.
 *
 * Refund tickets are customer grievances, so the resulting refund_event is
 * visible to that customer (refund_events_select_scoped) and to Super Admin.
 */

const RefundSchema = z.object({
  ticketId: z.string().uuid(),
  amountRupees: z.number().positive("Enter a refund amount greater than zero."),
  razorpayRefundId: z.string().trim().max(200).optional(),
  note: z.string().trim().min(1, "A note explaining the refund is required.").max(1000),
});

export async function recordManualRefund(input: z.infer<typeof RefundSchema>) {
  const profile = await requireSuperAdmin();
  const parsed = RefundSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: ticket } = await supabase
    .from("grievance_tickets")
    .select("id, order_id, requester_id")
    .eq("id", parsed.ticketId)
    .single();

  if (!ticket) throw new Error("Grievance not found.");
  if (!ticket.order_id) {
    throw new Error("This grievance isn't linked to an order, so a refund can't be recorded against it.");
  }

  // Resolve the captured payment for the order's group, if any, so the
  // refund ledger row points at the right payment.
  const { data: order } = await supabase
    .from("orders")
    .select("id, group_id")
    .eq("id", ticket.order_id)
    .single();

  let paymentId: string | null = null;
  if (order?.group_id) {
    const { data: payment } = await supabase
      .from("payments")
      .select("id")
      .eq("group_id", order.group_id)
      .maybeSingle();
    paymentId = payment?.id ?? null;
  }

  const amountPaise = rupeesToPaise(parsed.amountRupees);

  const { data: refund, error } = await supabase
    .from("refund_events")
    .insert({
      order_id: ticket.order_id,
      payment_id: paymentId,
      grievance_ticket_id: ticket.id,
      amount_paise: amountPaise,
      status: "recorded",
      requested_by: ticket.requester_id,
      decided_by: profile.id,
    })
    .select("id")
    .single();

  if (error || !refund) throw new Error(error?.message ?? "Could not record the refund.");

  await supabase.from("grievance_messages").insert({
    ticket_id: ticket.id,
    sender_id: profile.id,
    is_internal: true,
    body: `Manual refund recorded: ${parsed.amountRupees} (paise ${amountPaise})${
      parsed.razorpayRefundId ? `, ref ${parsed.razorpayRefundId}` : ""
    }.\n${parsed.note}`,
  });

  await supabase.from("grievance_events").insert({
    ticket_id: ticket.id,
    actor_id: profile.id,
    event_type: "refund_recorded",
    payload: { refundEventId: refund.id, amountPaise },
  });

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "super_admin",
    action: "refund.manual_recorded",
    targetTable: "refund_events",
    targetId: refund.id,
    after: { orderId: ticket.order_id, amountPaise, ticketId: ticket.id },
    reason: parsed.note,
  });

  revalidatePath(`/admin/grievances/${ticket.id}`);
  return { refundEventId: refund.id };
}
