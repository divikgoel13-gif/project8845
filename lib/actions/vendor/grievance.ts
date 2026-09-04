"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, requireRestaurantScope } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";
import { computeSlaDueTimes, getSlaPolicy } from "@/lib/grievance/sla";

/**
 * Vendor grievance creation + messaging (SRS Phase 6: "Vendor grievance
 * creation + messaging to Super Admin"; SRS §13 central CRM). Every ticket
 * a vendor opens has requester_role = 'vendor' and requester_id = the
 * vendor admin — which, via `grievance_tickets_select_own_or_admin`, means
 * it is visible ONLY to that vendor and to UNI8 Super Admin, never to
 * another restaurant (the §4/§13 hard requirement "Vendor grievances reach
 * UNI8 only").
 *
 * Vendor-Admin only. When the grievance concerns a specific restaurant, we
 * re-validate the caller actually manages it (requireRestaurantScope) so a
 * vendor can't attach a ticket to a restaurant that isn't theirs.
 */

// Categories a vendor can legitimately raise (the customer-only ones like
// wrong_item/missing_item are excluded from the vendor picker).
const VENDOR_CATEGORIES = ["payment", "refund", "vendor_issue", "account", "technical", "other"] as const;

const CreateSchema = z.object({
  restaurantId: z.string().uuid().nullable(),
  category: z.enum(VENDOR_CATEGORIES),
  body: z.string().trim().min(1, "Please describe your issue.").max(2000),
});

export async function createVendorGrievance(input: z.infer<typeof CreateSchema>) {
  const profile = await requireRole("vendor_admin");
  const parsed = CreateSchema.parse(input);

  if (parsed.restaurantId) {
    await requireRestaurantScope(parsed.restaurantId, ["vendor_admin"]);
  }

  const supabase = createServiceRoleSupabaseClient();

  // Phase 8B: vendor tickets get the same §13 SLA treatment as customer ones.
  // Without this the vendor path produced tickets with null due times, which the
  // support queue would read as "no clock" and quietly exclude from the breaching
  // view — a vendor payment dispute could sit unanswered without ever showing up
  // as overdue. Snapshotted at creation, like every other SLA in the system.
  const createdAt = new Date();
  const priority = parsed.category === "payment" ? "high" : "normal";
  const sla = computeSlaDueTimes(priority, await getSlaPolicy(), createdAt);

  const { data: ticket, error } = await supabase
    .from("grievance_tickets")
    .insert({
      requester_id: profile.id,
      requester_role: "vendor",
      category: parsed.category,
      priority,
      status: "open",
      restaurant_id: parsed.restaurantId,
      first_response_due_at: sla.firstResponseDueAt,
      resolution_due_at: sla.resolutionDueAt,
      sla_policy_snapshot: sla.snapshot,
    })
    .select("id")
    .single();

  if (error || !ticket) {
    throw new Error(error?.message ?? "Could not open your grievance.");
  }

  await supabase.from("grievance_messages").insert({
    ticket_id: ticket.id,
    sender_id: profile.id,
    is_internal: false,
    body: parsed.body,
  });

  await supabase.from("grievance_events").insert({
    ticket_id: ticket.id,
    actor_id: profile.id,
    event_type: "opened",
    payload: { category: parsed.category, restaurantId: parsed.restaurantId },
  });

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "grievance.vendor_opened",
    targetTable: "grievance_tickets",
    targetId: ticket.id,
    restaurantId: parsed.restaurantId ?? undefined,
    after: { category: parsed.category },
  });

  revalidatePath("/vendor/grievances");
  return { ticketId: ticket.id };
}

const MessageSchema = z.object({
  ticketId: z.string().uuid(),
  body: z.string().trim().min(1, "Message cannot be empty.").max(2000),
});

export async function postVendorGrievanceMessage(input: z.infer<typeof MessageSchema>) {
  const profile = await requireRole("vendor_admin");
  const parsed = MessageSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: ticket } = await supabase
    .from("grievance_tickets")
    .select("id, requester_id, requester_role, status")
    .eq("id", parsed.ticketId)
    .single();

  // Only the vendor who owns the ticket may add to it (service-role bypasses
  // RLS, so this ownership check is load-bearing, not decorative).
  if (!ticket || ticket.requester_id !== profile.id || ticket.requester_role !== "vendor") {
    throw new Error("Grievance not found.");
  }
  if (ticket.status === "closed") {
    throw new Error("This grievance is closed. Please open a new one if you still need help.");
  }

  await supabase.from("grievance_messages").insert({
    ticket_id: ticket.id,
    sender_id: profile.id,
    is_internal: false,
    body: parsed.body,
  });

  // A vendor reply on a ticket awaiting their input moves it back into
  // UNI8's queue.
  if (ticket.status === "waiting_vendor") {
    await supabase.from("grievance_tickets").update({ status: "in_review" }).eq("id", ticket.id);
  }

  revalidatePath(`/vendor/grievances/${ticket.id}`);
  revalidatePath("/vendor/grievances");
}
