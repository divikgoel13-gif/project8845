"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRestaurantScope } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";

/**
 * Vendor payout acknowledgement (SRS Phase 6: "Received / Not Received
 * acknowledgement," "Not-Received escalation to grievance CRM").
 *
 * A disbursement is created by Super Admin as `paid` (see
 * lib/actions/admin/disburse.ts). The vendor then confirms whether the
 * money actually arrived:
 *   * Received     → status `acknowledged_received`, acknowledged_at set.
 *   * Not Received → status `acknowledged_not_received`, AND a payment
 *     grievance is opened in the central CRM addressed to UNI8, with the
 *     disbursement back-linked (`not_received_escalated_ticket_id`). This is
 *     the ONLY automatic ticket-creation path in the disbursement flow, and
 *     it's what the Phase 6 deliverable "Not-Received escalation" requires.
 *
 * Vendor-Admin only (SRS §11: Staff has no payments access). The RLS policy
 * `disbursements_ack_vendor` allows an authenticated vendor admin to update
 * their own restaurant's disbursement rows, deliberately scoped by this
 * app layer to the acknowledgement fields only — but we run through the
 * service-role client here (consistent with every other action in the
 * codebase) after re-validating scope with requireRestaurantScope.
 */

const AckSchema = z.object({
  restaurantId: z.string().uuid(),
  disbursementId: z.string().uuid(),
});

async function loadDisbursement(disbursementId: string, restaurantId: string) {
  const supabase = createServiceRoleSupabaseClient();
  const { data } = await supabase
    .from("disbursements")
    .select("id, restaurant_id, status, amount_paise, reference, not_received_escalated_ticket_id")
    .eq("id", disbursementId)
    .single();

  if (!data || data.restaurant_id !== restaurantId) {
    throw new Error("Disbursement not found for this restaurant.");
  }
  return data;
}

/** Vendor confirms the payout landed. */
export async function markPayoutReceived(input: z.infer<typeof AckSchema>) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = AckSchema.parse(input);
  const disbursement = await loadDisbursement(parsed.disbursementId, parsed.restaurantId);

  if (disbursement.status !== "paid") {
    throw new Error("This payout can no longer be acknowledged.");
  }

  const supabase = createServiceRoleSupabaseClient();
  const acknowledgedAt = new Date().toISOString();
  const { error } = await supabase
    .from("disbursements")
    .update({ status: "acknowledged_received", acknowledged_at: acknowledgedAt })
    .eq("id", disbursement.id);
  if (error) throw new Error(error.message);

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "disbursement.acknowledged_received",
    targetTable: "disbursements",
    targetId: disbursement.id,
    restaurantId: parsed.restaurantId,
    before: { status: disbursement.status },
    after: { status: "acknowledged_received", acknowledgedAt },
  });

  revalidatePath("/vendor/payments");
}

const NotReceivedSchema = AckSchema.extend({
  note: z.string().trim().min(1, "Please describe what's wrong so UNI8 can help.").max(1000),
});

/**
 * Vendor reports the payout never arrived — this both marks the
 * disbursement and opens a payment grievance to UNI8, linked back to the
 * disbursement. The ticket's requester IS the vendor admin (requester_role
 * = 'vendor'), so it reaches Super Admin and only Super Admin
 * (grievance_tickets_select_own_or_admin) — never another vendor.
 */
export async function markPayoutNotReceived(input: z.infer<typeof NotReceivedSchema>) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = NotReceivedSchema.parse(input);
  const disbursement = await loadDisbursement(parsed.disbursementId, parsed.restaurantId);

  if (disbursement.status !== "paid") {
    throw new Error("This payout can no longer be disputed.");
  }

  const supabase = createServiceRoleSupabaseClient();

  // 1. Open the grievance first so we always have a ticket to link — if the
  //    disbursement update below fails, we have an orphan ticket (visible to
  //    UNI8) rather than a silently-lost dispute.
  const { data: ticket, error: ticketError } = await supabase
    .from("grievance_tickets")
    .insert({
      requester_id: profile.id,
      requester_role: "vendor",
      category: "payment",
      priority: "high",
      status: "open",
      restaurant_id: parsed.restaurantId,
    })
    .select("id")
    .single();

  if (ticketError || !ticket) {
    throw new Error(ticketError?.message ?? "Could not open a grievance for this payout.");
  }

  await supabase.from("grievance_messages").insert({
    ticket_id: ticket.id,
    sender_id: profile.id,
    is_internal: false,
    body: `Reported not received for disbursement ${disbursement.id} (₹ in paise: ${disbursement.amount_paise}${disbursement.reference ? `, ref ${disbursement.reference}` : ""}).\n\n${parsed.note}`,
  });

  await supabase.from("grievance_events").insert({
    ticket_id: ticket.id,
    actor_id: profile.id,
    event_type: "opened_from_payout_not_received",
    payload: { disbursementId: disbursement.id, amountPaise: disbursement.amount_paise },
  });

  // 2. Mark the disbursement and back-link the ticket.
  const acknowledgedAt = new Date().toISOString();
  const { error } = await supabase
    .from("disbursements")
    .update({
      status: "acknowledged_not_received",
      acknowledged_at: acknowledgedAt,
      not_received_escalated_ticket_id: ticket.id,
    })
    .eq("id", disbursement.id);
  if (error) throw new Error(error.message);

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "disbursement.acknowledged_not_received",
    targetTable: "disbursements",
    targetId: disbursement.id,
    restaurantId: parsed.restaurantId,
    before: { status: disbursement.status },
    after: { status: "acknowledged_not_received", escalatedTicketId: ticket.id },
    reason: parsed.note,
  });

  revalidatePath("/vendor/payments");
  revalidatePath("/vendor/grievances");
}
