import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ADMIN_PAGE_SIZE } from "@/components/ui/pagination";
import { evaluateSla, type SlaState } from "@/lib/grievance/sla";
import { signAttachmentPaths, type SignedAttachment } from "@/lib/grievance/attachments";
import type { Enums } from "@/types/database";

/**
 * Central grievance CRM read-side (SRS §13, Phase 8).
 *
 * This replaces the Phase 6 reader in lib/data/admin-grievances.ts, which knew
 * about six columns and one filter. §13 asks for eighteen CRM capabilities, and
 * three of them change how the queue has to be queried:
 *
 *  - "SLA — First-response and resolution timers; overdue highlighting". Breach
 *    is a relationship between two columns and `now`, and an agent's most
 *    important question ("what is overdue?") is therefore not a row filter that
 *    PostgREST can express cleanly. It is computed here, per row, by
 *    evaluateSla() against the due instants snapshotted on the ticket.
 *
 *  - "Search/filter — Ticket, person, restaurant, order, status, category,
 *    priority, assignee, date". Person is a name on a joined table, so search
 *    resolves profile ids first and filters on requester_id; a ticket number is
 *    an exact integer; an order looks like a uuid prefix. One text box, three
 *    different queries, decided by the shape of what was typed.
 *
 *  - "Every ticket has a complete auditable timeline" (Phase 8 completion
 *    standard). The timeline is assembled from four append-only sources —
 *    messages, events, assignments and refunds — merged on time, because no
 *    single table holds the whole story and none of them may be rewritten.
 *
 * Like the other admin readers this scans with a cap and says so rather than
 * silently under-reporting: totals and SLA counts are computed over the same
 * scanned set the page shows, so the stat tiles and the table can never
 * disagree with each other. At campus ticket volumes the cap is not reached.
 *
 * RLS-bound client throughout. A super admin's own policies
 * (`grievance_tickets_select_own_or_admin`, `grievance_messages_select_scoped`,
 * `grievance_assignments_select_super_admin`) already grant platform-wide
 * visibility including internal notes, so no service-role client is needed on
 * the read path — and the requester's own RLS keeps them out of it.
 */

/** How many tickets one filtered scan will look at. See the header. */
const SCAN_CAP = 2000;

export type GrievanceStatus = Enums<"grievance_status">;
export type GrievanceCategory = Enums<"grievance_category">;
export type GrievancePriority = Enums<"grievance_priority">;
export type GrievanceRequesterRole = Enums<"grievance_role">;

/** What an agent scanning the queue needs without opening anything. */
export type GrievanceQueueRow = {
  id: string;
  ticketNo: number | null;
  category: GrievanceCategory;
  status: GrievanceStatus;
  priority: GrievancePriority;
  requesterRole: GrievanceRequesterRole;
  requesterId: string;
  requesterName: string | null;
  requesterContact: string | null;
  restaurantId: string | null;
  restaurantName: string | null;
  orderId: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  createdAt: string;
  updatedAt: string;
  escalatedAt: string | null;
  reopenedCount: number;
  csatScore: number | null;
  /** Computed, never stored. Drives the §13 overdue highlighting. */
  sla: SlaState;
  /** Latest message on the requester-visible thread, for a one-line preview. */
  lastMessagePreview: string | null;
};

/** Queue view: what an agent is asking the list to show them. */
export type GrievanceQueueView =
  | "all"
  | "unassigned"
  | "mine"
  | "breaching"
  | "waiting_on_us"
  | "waiting_on_them"
  | "escalated"
  | "unresolved"
  | "resolved";

export type GrievanceSort = "updated" | "created" | "sla" | "priority" | "ticket";

export type GrievanceFilters = {
  search?: string;
  view?: GrievanceQueueView;
  requesterRole?: GrievanceRequesterRole;
  status?: GrievanceStatus;
  category?: GrievanceCategory;
  priority?: GrievancePriority;
  assigneeId?: string;
  restaurantId?: string;
  from?: string;
  to?: string;
  sort?: GrievanceSort;
  page?: number;
  pageSize?: number;
  /** The signed-in agent, so the "mine" view needs no second argument. */
  viewerId?: string;
};

export type GrievanceQueueTotals = {
  matched: number;
  unassigned: number;
  breaching: number;
  waitingOnUs: number;
  escalated: number;
  awaitingFirstResponse: number;
};

export type GrievanceQueueResult = {
  rows: GrievanceQueueRow[];
  totals: GrievanceQueueTotals;
  page: number;
  pageSize: number;
  total: number;
  truncated: boolean;
};

const SELECT_LIST =
  "id, ticket_no, category, status, priority, requester_role, requester_id, restaurant_id, order_id, " +
  "assignee_id, created_at, updated_at, escalated_at, reopened_count, csat_score, " +
  "first_response_at, first_response_due_at, resolved_at, resolution_due_at, " +
  "requester:profiles!grievance_tickets_requester_id_fkey(name, phone, email), " +
  "assignee:profiles!grievance_tickets_assignee_id_fkey(name), " +
  "restaurants(name)";

type TicketRow = {
  id: string;
  ticket_no: number | null;
  category: GrievanceCategory;
  status: GrievanceStatus;
  priority: GrievancePriority;
  requester_role: GrievanceRequesterRole;
  requester_id: string;
  restaurant_id: string | null;
  order_id: string | null;
  assignee_id: string | null;
  created_at: string;
  updated_at: string;
  escalated_at: string | null;
  reopened_count: number;
  csat_score: number | null;
  first_response_at: string | null;
  first_response_due_at: string | null;
  resolved_at: string | null;
  resolution_due_at: string | null;
  requester: { name: string | null; phone: string | null; email: string | null } | null;
  assignee: { name: string | null } | null;
  restaurants: { name: string } | null;
};

const PRIORITY_RANK: Record<GrievancePriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Statuses where the ball is in UNI8's court — the real work queue. */
const WAITING_ON_US: GrievanceStatus[] = ["open", "in_review", "escalated"];
const WAITING_ON_THEM: GrievanceStatus[] = ["waiting_customer", "waiting_vendor"];
const TERMINAL: GrievanceStatus[] = ["resolved", "closed"];

function toQueueRow(t: TicketRow, now: Date): GrievanceQueueRow {
  return {
    id: t.id,
    ticketNo: t.ticket_no,
    category: t.category,
    status: t.status,
    priority: t.priority,
    requesterRole: t.requester_role,
    requesterId: t.requester_id,
    requesterName: t.requester?.name ?? null,
    requesterContact: t.requester?.phone ?? t.requester?.email ?? null,
    restaurantId: t.restaurant_id,
    restaurantName: t.restaurants?.name ?? null,
    orderId: t.order_id,
    assigneeId: t.assignee_id,
    assigneeName: t.assignee?.name ?? null,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    escalatedAt: t.escalated_at,
    reopenedCount: t.reopened_count ?? 0,
    csatScore: t.csat_score,
    sla: evaluateSla(
      {
        status: t.status,
        firstResponseAt: t.first_response_at,
        firstResponseDueAt: t.first_response_due_at,
        resolvedAt: t.resolved_at,
        resolutionDueAt: t.resolution_due_at,
      },
      now
    ),
    lastMessagePreview: null,
  };
}

const UUID_PREFIX = /^[0-9a-f]{6,}(-[0-9a-f-]*)?$/i;

/**
 * One text box, decided by the shape of what was typed (§13 "Search/filter").
 *
 * A bare integer is a ticket number, because that is what an agent reads back
 * over the phone. Something that looks like the start of a uuid is an order or
 * ticket id, matched as a prefix in memory since PostgREST cannot pattern-match
 * a uuid column. Anything else is a person, resolved to profile ids first —
 * `requester_id.in.(…)` is a real index lookup, whereas filtering on an
 * embedded `profiles.name` would make the join drive the query.
 */
async function resolveSearch(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  search: string
): Promise<{ ticketNo?: number; requesterIds?: string[]; idPrefix?: string }> {
  const term = search.trim();
  if (!term) return {};

  if (/^\d+$/.test(term)) return { ticketNo: Number.parseInt(term, 10) };
  if (UUID_PREFIX.test(term)) return { idPrefix: term.toLowerCase() };

  const pattern = `%${term.replace(/[%_]/g, "")}%`;
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .or(`name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`)
    .limit(200);

  // An empty array is meaningful: nobody matched, so nothing should. Returning
  // undefined here would silently widen the search to every ticket.
  return { requesterIds: (data ?? []).map((p) => p.id) };
}

function matchesView(row: GrievanceQueueRow, view: GrievanceQueueView, viewerId?: string): boolean {
  switch (view) {
    case "unassigned":
      return row.assigneeId === null && !TERMINAL.includes(row.status);
    case "mine":
      return !!viewerId && row.assigneeId === viewerId;
    case "breaching":
      return row.sla.breached && !TERMINAL.includes(row.status);
    case "waiting_on_us":
      return WAITING_ON_US.includes(row.status);
    case "waiting_on_them":
      return WAITING_ON_THEM.includes(row.status);
    case "escalated":
      return row.status === "escalated" || row.escalatedAt !== null;
    case "unresolved":
      return !TERMINAL.includes(row.status);
    case "resolved":
      return TERMINAL.includes(row.status);
    default:
      return true;
  }
}

export async function listGrievances(filters: GrievanceFilters = {}): Promise<GrievanceQueueResult> {
  const supabase = createServerSupabaseClient();
  const now = new Date();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? ADMIN_PAGE_SIZE;

  const search = filters.search ? await resolveSearch(supabase, filters.search) : {};

  let query = supabase
    .from("grievance_tickets")
    .select(SELECT_LIST)
    .order("updated_at", { ascending: false })
    .limit(SCAN_CAP);

  if (filters.requesterRole) query = query.eq("requester_role", filters.requesterRole);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (filters.restaurantId) query = query.eq("restaurant_id", filters.restaurantId);
  if (filters.assigneeId === "none") query = query.is("assignee_id", null);
  else if (filters.assigneeId) query = query.eq("assignee_id", filters.assigneeId);
  if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00Z`);
  if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59Z`);
  if (search.ticketNo !== undefined) query = query.eq("ticket_no", search.ticketNo);
  if (search.requesterIds) query = query.in("requester_id", search.requesterIds);

  const { data, error } = await query;
  if (error || !data) {
    return {
      rows: [],
      totals: { matched: 0, unassigned: 0, breaching: 0, waitingOnUs: 0, escalated: 0, awaitingFirstResponse: 0 },
      page: 1,
      pageSize,
      total: 0,
      truncated: false,
    };
  }

  const scanned = data as unknown as TicketRow[];
  const truncated = scanned.length >= SCAN_CAP;

  let rows = scanned.map((t) => toQueueRow(t, now));
  if (search.idPrefix) {
    rows = rows.filter(
      (r) => r.id.startsWith(search.idPrefix!) || (r.orderId ?? "").startsWith(search.idPrefix!)
    );
  }

  const view = filters.view ?? "all";
  rows = rows.filter((r) => matchesView(r, view, filters.viewerId));

  // Totals describe exactly the set the table is showing, so a tile can never
  // claim something the rows below it contradict.
  const totals: GrievanceQueueTotals = {
    matched: rows.length,
    unassigned: rows.filter((r) => r.assigneeId === null && !TERMINAL.includes(r.status)).length,
    breaching: rows.filter((r) => r.sla.breached && !TERMINAL.includes(r.status)).length,
    waitingOnUs: rows.filter((r) => WAITING_ON_US.includes(r.status)).length,
    escalated: rows.filter((r) => r.status === "escalated").length,
    awaitingFirstResponse: rows.filter(
      (r) => r.sla.firstResponseDueAt !== null && !r.sla.firstResponseMet && !TERMINAL.includes(r.status)
    ).length,
  };

  const sort = filters.sort ?? "updated";
  rows.sort((a, b) => {
    switch (sort) {
      case "created":
        return b.createdAt.localeCompare(a.createdAt);
      case "ticket":
        return (b.ticketNo ?? 0) - (a.ticketNo ?? 0);
      case "priority":
        return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.updatedAt.localeCompare(a.updatedAt);
      case "sla": {
        // Tightest live clock first, and a breach outranks a healthy ticket
        // regardless of how much time is left on it. Terminal tickets have no
        // clock at all, so they sort last rather than as "infinitely urgent".
        const av = a.sla.minutesRemaining;
        const bv = b.sla.minutesRemaining;
        if (av === null && bv === null) return b.updatedAt.localeCompare(a.updatedAt);
        if (av === null) return 1;
        if (bv === null) return -1;
        return av - bv;
      }
      default:
        return b.updatedAt.localeCompare(a.updatedAt);
    }
  });

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  await attachPreviews(supabase, pageRows);

  return { rows: pageRows, totals, page, pageSize, total, truncated };
}

/**
 * Fills in the one-line preview for the rows actually being rendered.
 *
 * Deliberately after pagination: fetching the newest message for 2000 scanned
 * tickets to show 25 of them would be the expensive half of this module. The
 * preview reads the requester-visible thread only — an internal note must not
 * leak into a list an agent might screen-share, and a queue preview showing
 * UNI8's own working notes back to UNI8 tells them nothing anyway.
 */
async function attachPreviews(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  rows: GrievanceQueueRow[]
): Promise<void> {
  if (rows.length === 0) return;
  const { data } = await supabase
    .from("grievance_messages")
    .select("ticket_id, body, created_at")
    .in("ticket_id", rows.map((r) => r.id))
    .eq("is_internal", false)
    .order("created_at", { ascending: false })
    .limit(500);

  const newest = new Map<string, string>();
  for (const m of data ?? []) {
    if (!newest.has(m.ticket_id)) newest.set(m.ticket_id, m.body);
  }
  for (const row of rows) {
    const body = newest.get(row.id);
    row.lastMessagePreview = body ? body.replace(/\s+/g, " ").slice(0, 140) : null;
  }
}

export type GrievanceMessage = {
  id: string;
  body: string;
  createdAt: string;
  senderId: string;
  senderName: string | null;
  senderRole: string | null;
  isInternal: boolean;
  attachments: SignedAttachment[];
};

/** One row of the §13 immutable timeline, whichever table it came from. */
export type GrievanceTimelineEntry = {
  key: string;
  at: string;
  kind: "opened" | "message" | "note" | "event" | "assignment" | "refund";
  title: string;
  detail: string | null;
  actorName: string | null;
};

export type GrievanceLinkedOrder = {
  id: string;
  status: string;
  totalPaise: number;
  pickupTime: string | null;
  readyAt: string | null;
  collectedAt: string | null;
  restaurantName: string | null;
  groupId: string | null;
};

export type GrievanceLinkedPayment = {
  id: string;
  status: string;
  amountPaise: number;
  razorpayPaymentId: string | null;
  createdAt: string;
};

export type GrievanceRefund = {
  id: string;
  status: string;
  amountPaise: number;
  createdAt: string;
  razorpayRefundId: string | null;
};

export type GrievanceDetail = GrievanceQueueRow & {
  requesterEmail: string | null;
  requesterPhone: string | null;
  resolutionCategory: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  firstResponseAt: string | null;
  escalationReason: string | null;
  escalatedByName: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  csatComment: string | null;
  csatSubmittedAt: string | null;
  messages: GrievanceMessage[];
  /**
   * Every attachment on the ticket, including any that is not tied to a
   * message. `message_id` is nullable, so a thread-only rendering would hide
   * files — on a complaint record, a file support cannot see is worse than a
   * slightly redundant list.
   */
  attachments: SignedAttachment[];
  timeline: GrievanceTimelineEntry[];
  order: GrievanceLinkedOrder | null;
  payment: GrievanceLinkedPayment | null;
  refunds: GrievanceRefund[];
  /** Set when the ticket was opened by a vendor reporting a payout as not received. */
  disbursementId: string | null;
};

const SELECT_DETAIL =
  SELECT_LIST +
  ", resolution_category, resolution_note, resolved_at, closed_at, escalation_reason, " +
  "reopened_at, reopen_reason, csat_comment, csat_submitted_at, " +
  "escalator:profiles!grievance_tickets_escalated_by_fkey(name)";

export async function getGrievance(ticketId: string): Promise<GrievanceDetail | null> {
  const supabase = createServerSupabaseClient();
  const now = new Date();

  const { data: ticket } = await supabase
    .from("grievance_tickets")
    .select(SELECT_DETAIL)
    .eq("id", ticketId)
    .maybeSingle();

  if (!ticket) return null;

  const t = ticket as unknown as TicketRow & {
    resolution_category: string | null;
    resolution_note: string | null;
    resolved_at: string | null;
    closed_at: string | null;
    escalation_reason: string | null;
    reopened_at: string | null;
    reopen_reason: string | null;
    csat_comment: string | null;
    csat_submitted_at: string | null;
    escalator: { name: string | null } | null;
  };

  const [{ data: messages }, { data: attachments }, { data: events }, { data: assignments }] =
    await Promise.all([
      supabase
        .from("grievance_messages")
        .select("id, body, created_at, is_internal, sender_id, profiles!grievance_messages_sender_id_fkey(name, role)")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true }),
      supabase
        .from("grievance_attachments")
        .select("id, storage_path, message_id, created_at")
        .eq("ticket_id", ticketId),
      supabase
        .from("grievance_events")
        .select("id, event_type, payload, created_at, profiles!grievance_events_actor_id_fkey(name)")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true }),
      supabase
        .from("grievance_assignments")
        .select(
          "id, created_at, note, actor:profiles!grievance_assignments_actor_id_fkey(name), " +
            "to_profile:profiles!grievance_assignments_to_assignee_id_fkey(name)"
        )
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true }),
    ]);

  // Linked records (§13). The order is the hinge: the payment is reached
  // through the order's group (payments carry group_id, not order_id — see
  // docs/PHASE_STATUS.md), and the refund ledger is reached from either the
  // order or this ticket, so both are asked for and merged by id.
  let order: GrievanceLinkedOrder | null = null;
  let payment: GrievanceLinkedPayment | null = null;
  let refunds: GrievanceRefund[] = [];

  if (t.order_id) {
    const { data: o } = await supabase
      .from("orders")
      .select("id, status, subtotal_paise, pickup_time, ready_at, collected_at, group_id, restaurants(name)")
      .eq("id", t.order_id)
      .maybeSingle();

    if (o) {
      order = {
        id: o.id,
        status: o.status,
        totalPaise: o.subtotal_paise,
        pickupTime: o.pickup_time,
        readyAt: o.ready_at,
        collectedAt: o.collected_at,
        restaurantName: (o as unknown as { restaurants: { name: string } | null }).restaurants?.name ?? null,
        groupId: o.group_id,
      };

      if (o.group_id) {
        const { data: p } = await supabase
          .from("payments")
          .select("id, status, amount_paise, razorpay_payment_id, created_at")
          .eq("group_id", o.group_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (p) {
          payment = {
            id: p.id,
            status: p.status,
            amountPaise: p.amount_paise,
            razorpayPaymentId: p.razorpay_payment_id,
            createdAt: p.created_at,
          };
        }
      }
    }
  }

  const refundQueries = [
    supabase
      .from("refund_events")
      .select("id, status, amount_paise, created_at, razorpay_refund_id")
      .eq("grievance_ticket_id", ticketId),
  ];
  if (t.order_id) {
    refundQueries.push(
      supabase
        .from("refund_events")
        .select("id, status, amount_paise, created_at, razorpay_refund_id")
        .eq("order_id", t.order_id)
    );
  }
  const refundResults = await Promise.all(refundQueries);
  const byId = new Map<string, GrievanceRefund>();
  for (const { data } of refundResults) {
    for (const r of data ?? []) {
      byId.set(r.id, {
        id: r.id,
        status: r.status,
        amountPaise: r.amount_paise,
        createdAt: r.created_at,
        razorpayRefundId: r.razorpay_refund_id,
      });
    }
  }
  refunds = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Reverse link: a payout the vendor reported as never arriving carries the
  // ticket id, so the ticket can point back at the disbursement it is about.
  const { data: disb } = await supabase
    .from("disbursements")
    .select("id")
    .eq("not_received_escalated_ticket_id", ticketId)
    .limit(1)
    .maybeSingle();

  // Attachments live in a private bucket, so a path is not something the
  // browser can render. Each one is signed for a few minutes at render time
  // (§13 "private attachments"): nothing durable is handed to the client, and a
  // link that escapes the page stops working on its own.
  const signed = await signAttachmentPaths(
    supabase,
    (attachments ?? []).map((a) => ({
      id: a.id,
      storagePath: a.storage_path,
      createdAt: a.created_at,
      messageId: a.message_id,
    })),
  );
  const signedById = new Map(signed.map((s) => [s.id, s]));

  const attachmentsByMessage = new Map<string, SignedAttachment[]>();
  for (const a of attachments ?? []) {
    const key = a.message_id ?? "";
    const list = attachmentsByMessage.get(key) ?? [];
    const entry = signedById.get(a.id);
    if (entry) list.push(entry);
    attachmentsByMessage.set(key, list);
  }

  const mappedMessages: GrievanceMessage[] = (messages ?? []).map((m) => {
    const sender = (m as unknown as { profiles: { name: string | null; role: string | null } | null }).profiles;
    return {
      id: m.id,
      body: m.body,
      createdAt: m.created_at,
      senderId: m.sender_id,
      senderName: sender?.name ?? null,
      senderRole: sender?.role ?? null,
      isInternal: m.is_internal,
      attachments: attachmentsByMessage.get(m.id) ?? [],
    };
  });

  // §13 "Timeline — Immutable status/message/assignment/note/attachment/refund
  // events". Four append-only tables merged on time. Nothing here is derived
  // from mutable ticket columns, so the timeline cannot be rewritten by a later
  // status change — it can only be added to.
  const timeline: GrievanceTimelineEntry[] = [];

  for (const m of mappedMessages) {
    timeline.push({
      key: `m:${m.id}`,
      at: m.createdAt,
      kind: m.isInternal ? "note" : "message",
      title: m.isInternal ? "Internal note" : `${m.senderName ?? "Someone"} wrote`,
      detail: m.body.replace(/\s+/g, " ").slice(0, 200),
      actorName: m.senderName,
    });
  }

  for (const e of events ?? []) {
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    timeline.push({
      key: `e:${e.id}`,
      at: e.created_at,
      kind: e.event_type === "opened" ? "opened" : "event",
      title: e.event_type.replace(/_/g, " "),
      detail: describePayload(payload),
      actorName: (e as unknown as { profiles: { name: string | null } | null }).profiles?.name ?? null,
    });
  }

  for (const a of assignments ?? []) {
    const row = a as unknown as {
      id: string;
      created_at: string;
      note: string | null;
      actor: { name: string | null } | null;
      to_profile: { name: string | null } | null;
    };
    timeline.push({
      key: `a:${row.id}`,
      at: row.created_at,
      kind: "assignment",
      title: row.to_profile?.name ? `Assigned to ${row.to_profile.name}` : "Unassigned",
      detail: row.note,
      actorName: row.actor?.name ?? null,
    });
  }

  for (const r of refunds) {
    timeline.push({
      key: `r:${r.id}`,
      at: r.createdAt,
      kind: "refund",
      title: `Refund ${r.status}`,
      detail: `${(r.amountPaise / 100).toFixed(2)} rupees${r.razorpayRefundId ? ` · ${r.razorpayRefundId}` : ""}`,
      actorName: null,
    });
  }

  timeline.sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));

  const base = toQueueRow(t, now);
  base.lastMessagePreview =
    [...mappedMessages].reverse().find((m) => !m.isInternal)?.body.replace(/\s+/g, " ").slice(0, 140) ?? null;

  return {
    ...base,
    requesterEmail: t.requester?.email ?? null,
    requesterPhone: t.requester?.phone ?? null,
    resolutionCategory: t.resolution_category,
    resolutionNote: t.resolution_note,
    resolvedAt: t.resolved_at,
    closedAt: t.closed_at,
    firstResponseAt: t.first_response_at,
    escalationReason: t.escalation_reason,
    escalatedByName: t.escalator?.name ?? null,
    reopenedAt: t.reopened_at,
    reopenReason: t.reopen_reason,
    csatComment: t.csat_comment,
    csatSubmittedAt: t.csat_submitted_at,
    messages: mappedMessages,
    attachments: signed,
    timeline,
    order,
    payment,
    refunds,
    disbursementId: disb?.id ?? null,
  };
}

/** Renders an event payload without pretending to know every event type. */
function describePayload(payload: Record<string, unknown>): string | null {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "object") continue;
    parts.push(`${key.replace(/_/g, " ")}: ${String(value)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export type GrievanceTemplate = {
  id: string;
  name: string;
  category: GrievanceCategory | null;
  body: string;
  isActive: boolean;
};

/** §13 "Templates — Approved response macros". Active ones only, for the composer. */
export async function listGrievanceTemplates(includeInactive = false): Promise<GrievanceTemplate[]> {
  const supabase = createServerSupabaseClient();
  let query = supabase
    .from("grievance_templates")
    .select("id, name, category, body, is_active")
    .order("name");
  if (!includeInactive) query = query.eq("is_active", true);

  const { data } = await query;
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    body: r.body,
    isActive: r.is_active,
  }));
}

export type SupportAgent = { id: string; name: string | null; email: string | null };

/**
 * Who a ticket can be assigned to (§13 "Assign to Super Admin/support agent").
 *
 * Super admins only, and active ones only: assigning a ticket to a disabled
 * account would park it somewhere nobody is looking, which is worse than
 * leaving it unassigned where the queue counts it.
 */
export async function listSupportAgents(): Promise<SupportAgent[]> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, name, email")
    .eq("role", "super_admin")
    .eq("status", "active")
    .order("name");

  return (data ?? []).map((p) => ({ id: p.id, name: p.name, email: p.email }));
}

/** Restaurants, for the queue's restaurant filter. Name and id only. */
export async function listRestaurantOptions(): Promise<{ id: string; name: string }[]> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase.from("restaurants").select("id, name").order("name");
  return (data ?? []).map((r) => ({ id: r.id, name: r.name }));
}

