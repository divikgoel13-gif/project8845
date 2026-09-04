"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";
import { sendInAppNotification } from "@/lib/notifications/in-app";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  parseAttachmentPaths,
} from "@/lib/grievance/attachments";

/**
 * Super-Admin grievance CRM actions (SRS §13; Phase 6 baseline extended by
 * Phase 8B). UNI8 support is the ONLY party that can move a ticket's status,
 * assign it, escalate it or post an internal note — `requireSuperAdmin()` at
 * the top of every export is what enforces §4/§13's "Vendor Admins cannot
 * receive customer grievances" on the write side, exactly as
 * `grievance_tickets_update_super_admin` enforces it on the RLS side.
 *
 * Four properties hold across every action in this file, and each one is a
 * §13 completion-standard requirement rather than a style choice:
 *
 *  1. **Nothing is ever overwritten to make the timeline tidier.** Assignment
 *     changes append a `grievance_assignments` row (that table IS the
 *     reassignment history); status, priority, escalation and reopen changes
 *     append a `grievance_events` row. `grievance_tickets` columns are the
 *     current state; the append-only tables are the record of how it got
 *     there. Reopening therefore adds to the timeline and never truncates it.
 *
 *  2. **Resolution requires a note.** Enforced here, in the one place a
 *     status can change, because a resolution note that is optional in
 *     practice is not a resolution note.
 *
 *  3. **Every action is audited** through `recordAuditEvent()` with before and
 *     after state, so §18's audit log answers "who closed this and why"
 *     without reading the ticket.
 *
 *  4. **The requester is told when something changes for them**, via
 *     `sendInAppNotification` (§63). Internal notes never notify — that is the
 *     entire point of `is_internal`.
 *
 * Service-role client throughout (RLS bypassed), so the existence check on the
 * ticket before each write is load-bearing, not decorative.
 */

const GRIEVANCE_STATUSES = [
  "open",
  "in_review",
  "waiting_customer",
  "waiting_vendor",
  "escalated",
  "resolved",
  "closed",
] as const;

const GRIEVANCE_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

/** Where the requester's own view of a ticket lives, by role. */
function requesterLinkPath(requesterRole: string, ticketId: string): string {
  return requesterRole === "vendor" ? `/vendor/grievances/${ticketId}` : `/support/${ticketId}`;
}

function revalidateTicket(ticketId: string) {
  revalidatePath(`/admin/grievances/${ticketId}`);
  revalidatePath("/admin/grievances");
}

/* ── Messaging ──────────────────────────────────────────────────────────── */

const MessageSchema = z.object({
  ticketId: z.string().uuid(),
  body: z.string().trim().min(1, "Message cannot be empty.").max(4000),
  isInternal: z.boolean(),
  /** Optional: the approved template the agent started from (§13 templates). */
  templateKey: z.string().trim().max(120).optional(),
  /**
   * Storage paths already uploaded to the private bucket by the browser. The
   * file is in the bucket before this action runs; this list is what makes it
   * part of the ticket. Validated against the ticket id, never trusted as-is.
   */
  attachmentPaths: z.array(z.string()).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
});

export async function postAdminGrievanceMessage(input: z.infer<typeof MessageSchema>) {
  const profile = await requireSuperAdmin();
  const parsed = MessageSchema.parse(input);
  const attachmentPaths = parseAttachmentPaths(parsed.ticketId, parsed.attachmentPaths);
  const supabase = createServiceRoleSupabaseClient();

  const { data: ticket } = await supabase
    .from("grievance_tickets")
    .select("id, ticket_no, status, first_response_at, requester_role, requester_id")
    .eq("id", parsed.ticketId)
    .single();

  if (!ticket) throw new Error("Grievance not found.");

  const { data: message } = await supabase
    .from("grievance_messages")
    .insert({
      ticket_id: ticket.id,
      sender_id: profile.id,
      is_internal: parsed.isInternal,
      body: parsed.body,
    })
    .select("id")
    .single();

  // Attachments hang off the message, not the ticket, so the thread shows which
  // reply the evidence arrived with. An internal note's attachments inherit that
  // note's invisibility because the requester's reader filters on is_internal.
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

  // A public (non-internal) reply is the first response if none logged yet,
  // and moves the ticket to "waiting" on whoever raised it.
  const patch: Record<string, unknown> = {};
  if (!parsed.isInternal) {
    if (!ticket.first_response_at) patch.first_response_at = new Date().toISOString();
    if (ticket.status === "open" || ticket.status === "in_review") {
      patch.status = ticket.requester_role === "vendor" ? "waiting_vendor" : "waiting_customer";
    }
  }
  if (Object.keys(patch).length > 0) {
    patch.updated_at = new Date().toISOString();
    await supabase.from("grievance_tickets").update(patch).eq("id", ticket.id);
  }

  // The timeline records that support replied, not what they said — the
  // message row already holds the body, and duplicating it would create two
  // places to redact from.
  await supabase.from("grievance_events").insert({
    ticket_id: ticket.id,
    actor_id: profile.id,
    event_type: parsed.isInternal ? "internal_note_added" : "admin_replied",
    payload: {
      ...(parsed.templateKey ? { template: parsed.templateKey } : {}),
      ...(attachmentPaths.length > 0 ? { attachments: attachmentPaths.length } : {}),
    },
  });

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "super_admin",
    action: parsed.isInternal ? "grievance.internal_note_added" : "grievance.admin_replied",
    targetTable: "grievance_tickets",
    targetId: ticket.id,
    after:
      parsed.templateKey || attachmentPaths.length > 0
        ? {
            ...(parsed.templateKey ? { template: parsed.templateKey } : {}),
            ...(attachmentPaths.length > 0 ? { attachments: attachmentPaths } : {}),
          }
        : undefined,
  });

  // Internal notes are invisible to the requester, so notifying on one would
  // leak that support is discussing the ticket internally.
  if (!parsed.isInternal) {
    await sendInAppNotification({
      userId: ticket.requester_id,
      template: "grievance_replied",
      variables: { ticket_no: String(ticket.ticket_no ?? "") },
      fallback: {
        title: "Support replied",
        body: `UNI8 support replied to ticket #${ticket.ticket_no ?? ""}. Open it to read the reply.`,
      },
      linkPath: requesterLinkPath(ticket.requester_role, ticket.id),
      grievanceTicketId: ticket.id,
    });
  }

  revalidateTicket(ticket.id);
}

/* ── Status, resolution and closure ─────────────────────────────────────── */

const StatusSchema = z.object({
  ticketId: z.string().uuid(),
  status: z.enum(GRIEVANCE_STATUSES),
  resolutionNote: z.string().trim().max(2000).optional(),
  resolutionCategory: z.string().trim().max(100).optional(),
});

export async function setGrievanceStatus(input: z.infer<typeof StatusSchema>) {
  const profile = await requireSuperAdmin();
  const parsed = StatusSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: ticket } = await supabase
    .from("grievance_tickets")
    .select("id, ticket_no, status, requester_id, requester_role, resolved_at")
    .eq("id", parsed.ticketId)
    .single();

  if (!ticket) throw new Error("Grievance not found.");

  const isResolving = parsed.status === "resolved" || parsed.status === "closed";
  if (isResolving && !parsed.resolutionNote) {
    throw new Error("A resolution note is required to resolve or close a grievance.");
  }
  // §13 requires a resolution CATEGORY as well as a note. Phase 6 accepted a
  // note alone; asking for both is what makes resolution reasons countable in
  // analytics instead of buried in free text.
  if (isResolving && !parsed.resolutionCategory) {
    throw new Error("Choose a resolution category before resolving or closing.");
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: parsed.status, updated_at: now };
  if (isResolving) {
    // resolved_at is the moment the ticket was FIRST resolved — the SLA
    // resolution clock stops once, not again on a later close.
    patch.resolved_at = ticket.resolved_at ?? now;
    patch.resolution_note = parsed.resolutionNote;
    patch.resolution_category = parsed.resolutionCategory;
  }
  if (parsed.status === "closed") patch.closed_at = now;

  const { error } = await supabase.from("grievance_tickets").update(patch).eq("id", ticket.id);
  if (error) throw new Error(error.message);

  await supabase.from("grievance_events").insert({
    ticket_id: ticket.id,
    actor_id: profile.id,
    event_type: "status_changed",
    payload: {
      from: ticket.status,
      to: parsed.status,
      ...(isResolving ? { resolution_category: parsed.resolutionCategory } : {}),
    },
  });

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "super_admin",
    action: "grievance.status_changed",
    targetTable: "grievance_tickets",
    targetId: ticket.id,
    before: { status: ticket.status },
    after: { status: parsed.status, resolution_category: parsed.resolutionCategory ?? null },
    reason: parsed.resolutionNote,
  });

  if (isResolving) {
    await sendInAppNotification({
      userId: ticket.requester_id,
      template: "grievance_resolved",
      variables: { ticket_no: String(ticket.ticket_no ?? "") },
      fallback: {
        title: "Support ticket resolved",
        body: `Ticket #${ticket.ticket_no ?? ""} has been resolved. Open it to read the resolution or reopen it.`,
      },
      linkPath: requesterLinkPath(ticket.requester_role, ticket.id),
      grievanceTicketId: ticket.id,
    });
  }

  revalidateTicket(ticket.id);
}

/* ── Assignment and reassignment (§13 assignment history) ───────────────── */

const AssignSchema = z.object({
  ticketId: z.string().uuid(),
  /** null unassigns — a real operation when an agent goes off shift. */
  assigneeId: z.string().uuid().nullable(),
  note: z.string().trim().max(500).optional(),
});

export async function assignGrievance(input: z.infer<typeof AssignSchema>) {
  const profile = await requireSuperAdmin();
  const parsed = AssignSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: ticket } = await supabase
    .from("grievance_tickets")
    .select("id, ticket_no, status, assignee_id")
    .eq("id", parsed.ticketId)
    .single();

  if (!ticket) throw new Error("Grievance not found.");

  // A ticket may only be assigned to an ACTIVE super admin. Assigning to a
  // vendor or staff account would hand a customer grievance to the party it may
  // be about (§4); assigning to a disabled account parks the ticket somewhere
  // nobody is looking, which is worse than leaving it unassigned.
  if (parsed.assigneeId) {
    const { data: assignee } = await supabase
      .from("profiles")
      .select("id, role, status, name")
      .eq("id", parsed.assigneeId)
      .single();

    if (!assignee || assignee.role !== "super_admin") {
      throw new Error("Grievances can only be assigned to UNI8 super admins.");
    }
    if (assignee.status !== "active") {
      throw new Error("That account is not active and cannot take new tickets.");
    }
  }

  if (parsed.assigneeId === ticket.assignee_id) return; // nothing to record

  const now = new Date().toISOString();

  const patch: Record<string, unknown> = { assignee_id: parsed.assigneeId, updated_at: now };
  // Picking up an untouched ticket is the moment work starts on it.
  if (parsed.assigneeId && ticket.status === "open") patch.status = "in_review";

  const { error } = await supabase.from("grievance_tickets").update(patch).eq("id", ticket.id);
  if (error) throw new Error(error.message);

  // `grievance_assignments` IS the reassignment history — one row per hand-off,
  // never updated. The ticket's assignee_id is only the latest row's target.
  await supabase.from("grievance_assignments").insert({
    ticket_id: ticket.id,
    actor_id: profile.id,
    from_assignee_id: ticket.assignee_id,
    to_assignee_id: parsed.assigneeId,
    note: parsed.note ?? null,
  });

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "super_admin",
    action: parsed.assigneeId ? "grievance.assigned" : "grievance.unassigned",
    targetTable: "grievance_tickets",
    targetId: ticket.id,
    before: { assignee_id: ticket.assignee_id },
    after: { assignee_id: parsed.assigneeId },
    reason: parsed.note,
  });

  revalidateTicket(ticket.id);
}

/* ── Priority ───────────────────────────────────────────────────────────── */

const PrioritySchema = z.object({
  ticketId: z.string().uuid(),
  priority: z.enum(GRIEVANCE_PRIORITIES),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Changes priority WITHOUT recomputing the SLA due times.
 *
 * That is deliberate and it is the decision most likely to look like a bug. The
 * due times were snapshotted from the policy in force when the ticket was
 * raised (`sla_policy_snapshot`); re-deriving them from a new priority would let
 * an agent make an overdue ticket compliant by downgrading it. The priority
 * change is recorded on the timeline so a supervisor can see the judgement, and
 * the clock keeps running against the promise actually made to the requester.
 */
export async function setGrievancePriority(input: z.infer<typeof PrioritySchema>) {
  const profile = await requireSuperAdmin();
  const parsed = PrioritySchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: ticket } = await supabase
    .from("grievance_tickets")
    .select("id, priority")
    .eq("id", parsed.ticketId)
    .single();

  if (!ticket) throw new Error("Grievance not found.");
  if (ticket.priority === parsed.priority) return;

  const { error } = await supabase
    .from("grievance_tickets")
    .update({ priority: parsed.priority, updated_at: new Date().toISOString() })
    .eq("id", ticket.id);
  if (error) throw new Error(error.message);

  await supabase.from("grievance_events").insert({
    ticket_id: ticket.id,
    actor_id: profile.id,
    event_type: "priority_changed",
    payload: { from: ticket.priority, to: parsed.priority, reason: parsed.reason ?? null },
  });

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "super_admin",
    action: "grievance.priority_changed",
    targetTable: "grievance_tickets",
    targetId: ticket.id,
    before: { priority: ticket.priority },
    after: { priority: parsed.priority },
    reason: parsed.reason,
  });

  revalidateTicket(ticket.id);
}

/* ── Escalation (§13 senior-admin escalation with reason) ───────────────── */

const EscalateSchema = z.object({
  ticketId: z.string().uuid(),
  reason: z.string().trim().min(10, "Say why this needs escalating — at least a sentence.").max(1000),
  /** Optional: hand it to a named senior admin at the same time. */
  assigneeId: z.string().uuid().nullable().optional(),
});

export async function escalateGrievance(input: z.infer<typeof EscalateSchema>) {
  const profile = await requireSuperAdmin();
  const parsed = EscalateSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: ticket } = await supabase
    .from("grievance_tickets")
    .select("id, ticket_no, status, priority, escalated_at, assignee_id")
    .eq("id", parsed.ticketId)
    .single();

  if (!ticket) throw new Error("Grievance not found.");
  if (ticket.status === "resolved" || ticket.status === "closed") {
    throw new Error("Reopen this ticket before escalating it.");
  }

  const now = new Date().toISOString();

  // Escalating raises priority to at least 'high' but never lowers it: an
  // already-urgent ticket does not become less urgent by being escalated.
  const priority = ticket.priority === "urgent" ? "urgent" : "high";

  const { error } = await supabase
    .from("grievance_tickets")
    .update({
      status: "escalated",
      priority,
      // escalated_at is the FIRST escalation; a second escalation appends to the
      // timeline rather than resetting the clock on how long this has been out
      // of the ordinary queue.
      escalated_at: ticket.escalated_at ?? now,
      escalated_by: profile.id,
      escalation_reason: parsed.reason,
      updated_at: now,
    })
    .eq("id", ticket.id);
  if (error) throw new Error(error.message);

  await supabase.from("grievance_events").insert({
    ticket_id: ticket.id,
    actor_id: profile.id,
    event_type: "escalated",
    payload: { reason: parsed.reason, from_status: ticket.status, priority },
  });

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "super_admin",
    action: "grievance.escalated",
    targetTable: "grievance_tickets",
    targetId: ticket.id,
    before: { status: ticket.status, priority: ticket.priority },
    after: { status: "escalated", priority },
    reason: parsed.reason,
  });

  // Reassignment goes through the same audited path as any other hand-off, so
  // an escalation that changes owner still produces a grievance_assignments row.
  if (parsed.assigneeId !== undefined && parsed.assigneeId !== ticket.assignee_id) {
    await assignGrievance({
      ticketId: ticket.id,
      assigneeId: parsed.assigneeId,
      note: "Escalation hand-off",
    });
  }

  revalidateTicket(ticket.id);
}

/* ── Reopen (§13 "timeline preserved") ──────────────────────────────────── */

const ReopenSchema = z.object({
  ticketId: z.string().uuid(),
  reason: z.string().trim().min(5, "Give a reason for reopening.").max(1000),
});

/**
 * Reopens a resolved or closed ticket.
 *
 * Note what is NOT cleared: `resolution_note`, `resolution_category`,
 * `resolved_at`, `closed_at` and every message, event and assignment row stay
 * exactly as they were. The Phase 8 completion standard is "Reopening preserves
 * history", and the previous resolution is the most important part of that
 * history — it is what the reopen is disputing. `reopened_count` and
 * `reopened_at` are the current-state summary; the events table holds each
 * individual reopening.
 *
 * The SLA is a genuine judgement call and the choice here is to leave the
 * original due times alone for the same reason as `setGrievancePriority`: a
 * reopened ticket that was resolved late should still read as late. Support can
 * see `reopened_count` and escalate if a ticket keeps coming back.
 */
export async function reopenGrievance(input: z.infer<typeof ReopenSchema>) {
  const profile = await requireSuperAdmin();
  const parsed = ReopenSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: ticket } = await supabase
    .from("grievance_tickets")
    .select("id, ticket_no, status, reopened_count, requester_id, requester_role")
    .eq("id", parsed.ticketId)
    .single();

  if (!ticket) throw new Error("Grievance not found.");
  if (ticket.status !== "resolved" && ticket.status !== "closed") {
    throw new Error("Only a resolved or closed grievance can be reopened.");
  }

  const now = new Date().toISOString();

  const { error } = await supabase
    .from("grievance_tickets")
    .update({
      status: "in_review",
      reopened_at: now,
      reopen_reason: parsed.reason,
      reopened_count: (ticket.reopened_count ?? 0) + 1,
      updated_at: now,
    })
    .eq("id", ticket.id);
  if (error) throw new Error(error.message);

  await supabase.from("grievance_events").insert({
    ticket_id: ticket.id,
    actor_id: profile.id,
    event_type: "reopened",
    payload: { reason: parsed.reason, from_status: ticket.status, reopen_number: (ticket.reopened_count ?? 0) + 1 },
  });

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "super_admin",
    action: "grievance.reopened",
    targetTable: "grievance_tickets",
    targetId: ticket.id,
    before: { status: ticket.status, reopened_count: ticket.reopened_count },
    after: { status: "in_review", reopened_count: (ticket.reopened_count ?? 0) + 1 },
    reason: parsed.reason,
  });

  await sendInAppNotification({
    userId: ticket.requester_id,
    template: "grievance_replied",
    variables: { ticket_no: String(ticket.ticket_no ?? "") },
    fallback: {
      title: "Ticket reopened",
      body: `UNI8 support reopened ticket #${ticket.ticket_no ?? ""} and is looking at it again.`,
    },
    linkPath: requesterLinkPath(ticket.requester_role, ticket.id),
    grievanceTicketId: ticket.id,
  });

  revalidateTicket(ticket.id);
}

/* ── Approved response templates (§13 "Templates") ──────────────────────── */

const GRIEVANCE_CATEGORIES = [
  "payment",
  "refund",
  "wrong_item",
  "missing_item",
  "pickup",
  "qr",
  "vendor_issue",
  "staff_issue",
  "product_issue",
  "account",
  "technical",
  "other",
] as const;

const TemplateSchema = z.object({
  name: z.string().trim().min(2, "Give the template a name.").max(120),
  category: z.enum(GRIEVANCE_CATEGORIES).nullable(),
  body: z.string().trim().min(10, "A template needs some copy.").max(4000),
});

export async function createGrievanceTemplate(input: z.infer<typeof TemplateSchema>) {
  const profile = await requireSuperAdmin();
  const parsed = TemplateSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: template, error } = await supabase
    .from("grievance_templates")
    .insert({
      name: parsed.name,
      category: parsed.category,
      body: parsed.body,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error) {
    // uq_grievance_templates_name is case-insensitive, so say so rather than
    // surfacing a raw constraint name.
    throw new Error(
      error.code === "23505" || /duplicate key/i.test(error.message)
        ? "A template with that name already exists."
        : error.message
    );
  }

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "super_admin",
    action: "grievance_template.created",
    targetTable: "grievance_templates",
    targetId: template?.id,
    after: { name: parsed.name, category: parsed.category },
  });

  revalidatePath("/admin/grievances");
  return { templateId: template!.id };
}

const TemplateStateSchema = z.object({
  templateId: z.string().uuid(),
  isActive: z.boolean(),
});

/**
 * Retires or restores a template. Deliberately not a delete: a retired template
 * is still the wording that went out to requesters while it was live, and §P's
 * "no destructive removal of history" applies to support copy as much as to
 * audit rows. Retired templates simply stop appearing in the composer picker.
 */
export async function setGrievanceTemplateActive(input: z.infer<typeof TemplateStateSchema>) {
  const profile = await requireSuperAdmin();
  const parsed = TemplateStateSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: before } = await supabase
    .from("grievance_templates")
    .select("id, name, is_active")
    .eq("id", parsed.templateId)
    .single();

  if (!before) throw new Error("Template not found.");
  if (before.is_active === parsed.isActive) return;

  const { error } = await supabase
    .from("grievance_templates")
    .update({ is_active: parsed.isActive, updated_at: new Date().toISOString() })
    .eq("id", parsed.templateId);
  if (error) throw new Error(error.message);

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "super_admin",
    action: parsed.isActive ? "grievance_template.restored" : "grievance_template.retired",
    targetTable: "grievance_templates",
    targetId: parsed.templateId,
    before: { is_active: before.is_active },
    after: { is_active: parsed.isActive },
  });

  revalidatePath("/admin/grievances");
}

/* ── Linked records (§13 "Linked records") ──────────────────────────────── */

const LinkSchema = z.object({
  ticketId: z.string().uuid(),
  orderId: z.string().uuid().nullable(),
  restaurantId: z.string().uuid().nullable(),
});

/**
 * Attaches or corrects a ticket's order/restaurant linkage.
 *
 * Needed because the two automated creation paths (§I order-issue shortcut, §59
 * not-ready prompt) always know the order, but a ticket raised from a phone call
 * or the generic support form does not — and §13's linked-record requirement is
 * what makes a ticket findable from the order and vice versa. When an order is
 * supplied, its restaurant is taken from the order rather than from the form, so
 * a mistyped pairing cannot be stored.
 */
export async function linkGrievanceRecords(input: z.infer<typeof LinkSchema>) {
  const profile = await requireSuperAdmin();
  const parsed = LinkSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: ticket } = await supabase
    .from("grievance_tickets")
    .select("id, order_id, restaurant_id")
    .eq("id", parsed.ticketId)
    .single();

  if (!ticket) throw new Error("Grievance not found.");

  let restaurantId = parsed.restaurantId;

  if (parsed.orderId) {
    const { data: order } = await supabase
      .from("orders")
      .select("id, restaurant_id")
      .eq("id", parsed.orderId)
      .single();

    if (!order) throw new Error("That order does not exist.");
    restaurantId = order.restaurant_id;
  }

  const { error } = await supabase
    .from("grievance_tickets")
    .update({
      order_id: parsed.orderId,
      restaurant_id: restaurantId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ticket.id);
  if (error) throw new Error(error.message);

  await supabase.from("grievance_events").insert({
    ticket_id: ticket.id,
    actor_id: profile.id,
    event_type: "records_linked",
    payload: { order_id: parsed.orderId, restaurant_id: restaurantId },
  });

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "super_admin",
    action: "grievance.records_linked",
    targetTable: "grievance_tickets",
    targetId: ticket.id,
    before: { order_id: ticket.order_id, restaurant_id: ticket.restaurant_id },
    after: { order_id: parsed.orderId, restaurant_id: restaurantId },
    restaurantId: restaurantId ?? undefined,
  });

  revalidateTicket(ticket.id);
}



