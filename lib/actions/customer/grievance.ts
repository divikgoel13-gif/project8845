"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";
import { computeSlaDueTimes, getSlaPolicy } from "@/lib/grievance/sla";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  parseAttachmentPaths,
} from "@/lib/grievance/attachments";
import { sendInAppNotification } from "@/lib/notifications/in-app";

/**
 * Customer order-issue shortcuts (SRS V2 §I) and the not-ready prompt
 * (V2.6 §59).
 *
 * §I sets the shape of this file more than §13 does: "Customers do not access
 * the internal CRM" and "the selection auto-populates order ID, restaurant,
 * customer and category". So the only thing a customer ever supplies is an
 * ORDER they already own plus a choice from a fixed list and, optionally, a
 * sentence of description. Every other field is derived server-side:
 *
 *  - `order_id` is validated against the caller's own orders. There is no code
 *    path where a customer-typed order reference is trusted, because there is no
 *    code path where one is accepted.
 *  - `restaurant_id` is read FROM the order, never from the request, so a ticket
 *    can never be filed against a restaurant the order was not placed with.
 *  - `category` and `priority` come from the issue map below.
 *  - `requester_role` is hard-coded `'customer'`, which is what routes the
 *    ticket to UNI8 support: `grievance_tickets_select_own_or_admin` gives read
 *    access to the requester and super admins only, so a Vendor Admin cannot
 *    see it. §I's "never to Vendor Admin" is a property of the schema here, not
 *    a routing rule someone has to remember.
 *
 * The service-role client is used because a ticket write touches four tables and
 * needs to snapshot the SLA policy; `requireProfile()` plus the explicit
 * ownership lookups are what stand in for RLS on this path.
 */

/**
 * The §I picker, verbatim in intent: "Wrong item, Missing item, Food/order
 * issue, Pickup issue, QR problem, Payment/refund issue, Restaurant issue,
 * Other". Each maps to a `grievance_category` enum value and a starting
 * priority. Payment and QR problems start `high` because both block the
 * customer from getting either their food or their money, and neither resolves
 * itself by waiting.
 */
const ISSUE_MAP = {
  wrong_item: { category: "wrong_item", priority: "normal" },
  missing_item: { category: "missing_item", priority: "normal" },
  food_issue: { category: "product_issue", priority: "normal" },
  pickup_issue: { category: "pickup", priority: "high" },
  qr_problem: { category: "qr", priority: "high" },
  payment_issue: { category: "payment", priority: "high" },
  restaurant_issue: { category: "vendor_issue", priority: "normal" },
  not_ready: { category: "pickup", priority: "high" },
  other: { category: "other", priority: "normal" },
} as const;

type IssueKey = keyof typeof ISSUE_MAP;

const CreateSchema = z.object({
  orderId: z.string().uuid(),
  issue: z.enum(Object.keys(ISSUE_MAP) as [IssueKey, ...IssueKey[]]),
  body: z.string().trim().max(2000).optional(),
});

/** Copy used when the customer adds nothing of their own. */
const DEFAULT_BODY: Record<IssueKey, string> = {
  wrong_item: "I received the wrong item.",
  missing_item: "An item was missing from my order.",
  food_issue: "There was a problem with the food in this order.",
  pickup_issue: "I had a problem collecting this order.",
  qr_problem: "My pickup QR would not work at the counter.",
  payment_issue: "I have a payment or refund problem with this order.",
  restaurant_issue: "I had a problem with the restaurant on this order.",
  // §59: "must not declare the restaurant at fault". The customer is reporting
  // elapsed time, which is a fact; who is responsible is what support determines.
  not_ready:
    "My order is marked ready for pickup but I have not been able to collect it. Raised automatically from the pickup screen.",
  other: "I need help with this order.",
};

export type CreateOrderIssueResult = {
  ticketId: string;
  ticketNo: number | null;
  /** True when an existing live ticket was returned instead of a new one. */
  existing: boolean;
};

export async function createOrderIssueTicket(
  input: z.infer<typeof CreateSchema>
): Promise<CreateOrderIssueResult> {
  const profile = await requireProfile();
  const parsed = CreateSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  // The order must exist, must belong to this customer, and must be past the
  // point where there is anything to complain about. A payment_pending order has
  // no restaurant obligation attached to it yet.
  const { data: order } = await supabase
    .from("orders")
    .select("id, customer_id, restaurant_id, status, group_id")
    .eq("id", parsed.orderId)
    .maybeSingle();

  if (!order || order.customer_id !== profile.id) {
    throw new Error("Order not found.");
  }
  if (order.status === "payment_pending") {
    throw new Error("This order was never paid for, so there is nothing to raise yet.");
  }

  const mapped = ISSUE_MAP[parsed.issue];

  // §59 duplicate guard, applied to the manual path too: a customer who taps
  // twice gets their existing ticket rather than two threads support has to
  // reconcile. Only live tickets count — a new problem on an old resolved order
  // is a new ticket.
  const { data: existing } = await supabase
    .from("grievance_tickets")
    .select("id, ticket_no, status")
    .eq("order_id", order.id)
    .eq("requester_id", profile.id)
    .not("status", "in", "(resolved,closed)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Still record what they came back to say, so the second tap is not lost.
    if (parsed.body) {
      await supabase.from("grievance_messages").insert({
        ticket_id: existing.id,
        sender_id: profile.id,
        is_internal: false,
        body: parsed.body,
      });
      await supabase
        .from("grievance_tickets")
        .update({ status: existing.status === "waiting_customer" ? "in_review" : existing.status, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
    revalidatePath("/support");
    return { ticketId: existing.id, ticketNo: existing.ticket_no ?? null, existing: true };
  }

  const createdAt = new Date();
  const policy = await getSlaPolicy();
  const sla = computeSlaDueTimes(mapped.priority, policy, createdAt);

  const { data: ticket, error } = await supabase
    .from("grievance_tickets")
    .insert({
      requester_id: profile.id,
      requester_role: "customer",
      category: mapped.category,
      priority: mapped.priority,
      status: "open",
      order_id: order.id,
      restaurant_id: order.restaurant_id, // from the order, never from the client
      first_response_due_at: sla.firstResponseDueAt,
      resolution_due_at: sla.resolutionDueAt,
      sla_policy_snapshot: sla.snapshot,
    })
    .select("id, ticket_no")
    .single();

  if (error || !ticket) {
    throw new Error(error?.message ?? "Could not raise your ticket. Please try again.");
  }

  await supabase.from("grievance_messages").insert({
    ticket_id: ticket.id,
    sender_id: profile.id,
    is_internal: false,
    body: parsed.body?.trim() || DEFAULT_BODY[parsed.issue],
  });

  await supabase.from("grievance_events").insert({
    ticket_id: ticket.id,
    actor_id: profile.id,
    event_type: "opened",
    payload: {
      issue: parsed.issue,
      category: mapped.category,
      order_id: order.id,
      restaurant_id: order.restaurant_id,
      source: parsed.issue === "not_ready" ? "not_ready_prompt" : "order_issue_shortcut",
    },
  });

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "customer",
    action: "grievance.customer_opened",
    targetTable: "grievance_tickets",
    targetId: ticket.id,
    restaurantId: order.restaurant_id ?? undefined,
    after: { issue: parsed.issue, category: mapped.category, order_id: order.id },
  });

  // §59: "the customer can follow the resulting ticket" — and they never typed a
  // reference, so we have to hand them one.
  await sendInAppNotification({
    userId: profile.id,
    template: "grievance_opened",
    variables: { ticket_no: String(ticket.ticket_no ?? "") },
    fallback: {
      title: "We have your ticket",
      body: `Ticket #${ticket.ticket_no ?? ""} is open with UNI8 support. We will reply here.`,
    },
    linkPath: `/support/${ticket.id}`,
    grievanceTicketId: ticket.id,
    orderId: order.id,
    restaurantId: order.restaurant_id,
  });

  revalidatePath("/support");
  revalidatePath(`/orders/${order.group_id}`);
  revalidatePath("/admin/grievances");

  return { ticketId: ticket.id, ticketNo: ticket.ticket_no ?? null, existing: false };
}

/* ── Customer replies ───────────────────────────────────────────────────── */

const MessageSchema = z.object({
  ticketId: z.string().uuid(),
  body: z.string().trim().min(1, "Write a message first.").max(2000),
  /**
   * Paths the browser has already uploaded into the private bucket. Migration
   * 0018's Storage policies let a requester write under `ticket/<their ticket>/`
   * on an open ticket; this list is what turns those files into part of the
   * thread, and it is re-checked here because a path is just a string.
   */
  attachmentPaths: z.array(z.string()).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
});

export async function postCustomerGrievanceMessage(input: z.infer<typeof MessageSchema>) {
  const profile = await requireProfile();
  const parsed = MessageSchema.parse(input);
  const attachmentPaths = parseAttachmentPaths(parsed.ticketId, parsed.attachmentPaths);
  const supabase = createServiceRoleSupabaseClient();

  const { data: ticket } = await supabase
    .from("grievance_tickets")
    .select("id, requester_id, requester_role, status")
    .eq("id", parsed.ticketId)
    .maybeSingle();

  // Service-role bypasses RLS, so this ownership check is the fence.
  if (!ticket || ticket.requester_id !== profile.id || ticket.requester_role !== "customer") {
    throw new Error("Ticket not found.");
  }
  if (ticket.status === "closed") {
    throw new Error("This ticket is closed. Reopen it if you still need help.");
  }

  const { data: message } = await supabase
    .from("grievance_messages")
    .insert({
      ticket_id: ticket.id,
      sender_id: profile.id,
      is_internal: false, // a customer cannot create an internal note
      body: parsed.body,
    })
    .select("id")
    .single();

  if (attachmentPaths.length > 0 && message) {
    await supabase.from("grievance_attachments").insert(
      attachmentPaths.map((storagePath) => ({
        ticket_id: ticket.id,
        message_id: message.id,
        storage_path: storagePath,
        uploaded_by: profile.id,
      })),
    );
  }

  // A customer reply on a ticket that was waiting on them puts it back in
  // UNI8's queue. Without this, answering a support question leaves the ticket
  // parked in a state support filters out.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (ticket.status === "waiting_customer" || ticket.status === "resolved") {
    patch.status = "in_review";
  }
  await supabase.from("grievance_tickets").update(patch).eq("id", ticket.id);

  revalidatePath(`/support/${ticket.id}`);
  revalidatePath("/support");
  revalidatePath(`/admin/grievances/${ticket.id}`);
}

/* ── Customer reopen (§13 "Requester ... can reopen with reason") ────────── */

const ReopenSchema = z.object({
  ticketId: z.string().uuid(),
  reason: z.string().trim().min(5, "Tell us what is still wrong.").max(1000),
});

/**
 * The requester's own reopen path. Same preservation rule as the admin one:
 * nothing is cleared, the reason is appended to the timeline, and
 * `reopened_count` rises so support can see a ticket that keeps coming back.
 */
export async function reopenCustomerGrievance(input: z.infer<typeof ReopenSchema>) {
  const profile = await requireProfile();
  const parsed = ReopenSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: ticket } = await supabase
    .from("grievance_tickets")
    .select("id, requester_id, requester_role, status, reopened_count")
    .eq("id", parsed.ticketId)
    .maybeSingle();

  if (!ticket || ticket.requester_id !== profile.id || ticket.requester_role !== "customer") {
    throw new Error("Ticket not found.");
  }
  if (ticket.status !== "resolved" && ticket.status !== "closed") {
    throw new Error("This ticket is already open.");
  }

  const now = new Date().toISOString();

  await supabase
    .from("grievance_tickets")
    .update({
      status: "in_review",
      reopened_at: now,
      reopen_reason: parsed.reason,
      reopened_count: (ticket.reopened_count ?? 0) + 1,
      updated_at: now,
    })
    .eq("id", ticket.id);

  await supabase.from("grievance_messages").insert({
    ticket_id: ticket.id,
    sender_id: profile.id,
    is_internal: false,
    body: parsed.reason,
  });

  await supabase.from("grievance_events").insert({
    ticket_id: ticket.id,
    actor_id: profile.id,
    event_type: "reopened",
    payload: {
      reason: parsed.reason,
      from_status: ticket.status,
      by: "requester",
      reopen_number: (ticket.reopened_count ?? 0) + 1,
    },
  });

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "customer",
    action: "grievance.customer_reopened",
    targetTable: "grievance_tickets",
    targetId: ticket.id,
    before: { status: ticket.status, reopened_count: ticket.reopened_count },
    after: { status: "in_review", reopened_count: (ticket.reopened_count ?? 0) + 1 },
    reason: parsed.reason,
  });

  revalidatePath(`/support/${ticket.id}`);
  revalidatePath("/support");
  revalidatePath(`/admin/grievances/${ticket.id}`);
}

/* ── Post-resolution CSAT (§13, optional) ───────────────────────────────── */

const CsatSchema = z.object({
  ticketId: z.string().uuid(),
  score: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

/**
 * Records satisfaction with how the ticket was handled. Optional by §13, and
 * accepted only once — a second submission would let a score be revised after a
 * support conversation about the score, which is the one thing that makes a CSAT
 * number worthless. The 1-5 range is also enforced by the 0016 check constraint.
 */
export async function submitGrievanceCsat(input: z.infer<typeof CsatSchema>) {
  const profile = await requireProfile();
  const parsed = CsatSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: ticket } = await supabase
    .from("grievance_tickets")
    .select("id, requester_id, requester_role, status, csat_score")
    .eq("id", parsed.ticketId)
    .maybeSingle();

  if (!ticket || ticket.requester_id !== profile.id || ticket.requester_role !== "customer") {
    throw new Error("Ticket not found.");
  }
  if (ticket.status !== "resolved" && ticket.status !== "closed") {
    throw new Error("You can rate the support you got once the ticket is resolved.");
  }
  if (ticket.csat_score !== null && ticket.csat_score !== undefined) {
    throw new Error("You have already rated this ticket.");
  }

  const now = new Date().toISOString();

  await supabase
    .from("grievance_tickets")
    .update({
      csat_score: parsed.score,
      csat_comment: parsed.comment ?? null,
      csat_submitted_at: now,
      // Deliberately NOT touching updated_at: a CSAT submission is not ticket
      // activity, and bumping it would push resolved tickets back to the top of
      // support's "recently updated" queue for no actionable reason.
    })
    .eq("id", ticket.id);

  await supabase.from("grievance_events").insert({
    ticket_id: ticket.id,
    actor_id: profile.id,
    event_type: "csat_submitted",
    payload: { score: parsed.score },
  });

  revalidatePath(`/support/${ticket.id}`);
  revalidatePath(`/admin/grievances/${ticket.id}`);
}

