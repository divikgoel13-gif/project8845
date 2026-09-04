import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { signAttachmentPaths, type SignedAttachment } from "@/lib/grievance/attachments";
import type { Enums } from "@/types/database";

/**
 * Customer-side grievance reads (SRS V2 §I, V2.6 §59).
 *
 * §I is explicit that "Customers do not access the internal CRM", so this is a
 * deliberately thin view of the same tickets the admin workspace shows: no
 * assignee, no SLA clock, no internal notes, no escalation reason, no audit
 * trail. A customer sees their own conversation and the outcome.
 *
 * The RLS-bound client is used on purpose, not the service-role one:
 *  - `grievance_tickets_select_own_or_admin` restricts rows to
 *    `requester_id = auth.uid()`, so a guessed ticket id returns nothing;
 *  - `grievance_messages_select_scoped` hides `is_internal` messages from the
 *    requester in Postgres.
 * Both guarantees therefore hold even if this file is later edited carelessly.
 * The explicit `requester_id` check below is defence in depth, not the fence.
 */

export type CustomerTicketRow = {
  id: string;
  ticketNo: number | null;
  category: Enums<"grievance_category">;
  status: Enums<"grievance_status">;
  createdAt: string;
  updatedAt: string;
  orderId: string | null;
  restaurantName: string | null;
  /** Set once support has resolved it — drives the CSAT prompt. */
  resolvedAt: string | null;
  csatScore: number | null;
};

export type CustomerTicketMessage = {
  id: string;
  body: string;
  createdAt: string;
  fromSupport: boolean;
  /** Files attached to this message, signed for a few minutes at render time. */
  attachments: SignedAttachment[];
};

export type CustomerTicketDetail = CustomerTicketRow & {
  priority: Enums<"grievance_priority">;
  resolutionNote: string | null;
  closedAt: string | null;
  reopenedCount: number;
  messages: CustomerTicketMessage[];
  /**
   * Whether the customer may still add files. Migration 0018's Storage insert
   * policy blocks uploads on resolved/closed tickets, so the UI has to agree
   * with it — offering a file picker that the bucket will reject is a worse
   * experience than not offering one.
   */
  canAttach: boolean;
};

const LIST_SELECT =
  "id, ticket_no, category, status, created_at, updated_at, order_id, resolved_at, csat_score, restaurants(name)";

/** Every ticket this customer raised, newest activity first. */
export async function listCustomerTickets(customerId: string): Promise<CustomerTicketRow[]> {
  const supabase = createServerSupabaseClient();

  const { data } = await supabase
    .from("grievance_tickets")
    .select(LIST_SELECT)
    .eq("requester_id", customerId)
    .eq("requester_role", "customer")
    .order("updated_at", { ascending: false })
    .limit(100);

  return (data ?? []).map(toRow);
}

function toRow(t: any): CustomerTicketRow {
  return {
    id: t.id,
    ticketNo: t.ticket_no ?? null,
    category: t.category,
    status: t.status,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    orderId: t.order_id,
    restaurantName: t.restaurants?.name ?? null,
    resolvedAt: t.resolved_at ?? null,
    csatScore: t.csat_score ?? null,
  };
}

export async function getCustomerTicket(
  ticketId: string,
  customerId: string
): Promise<CustomerTicketDetail | null> {
  const supabase = createServerSupabaseClient();

  const { data: ticket } = await supabase
    .from("grievance_tickets")
    .select(
      LIST_SELECT +
        ", requester_id, requester_role, priority, resolution_note, closed_at, reopened_count"
    )
    .eq("id", ticketId)
    .maybeSingle();

  const row = ticket as any;
  if (!row || row.requester_id !== customerId || row.requester_role !== "customer") return null;

  const { data: messages } = await supabase
    .from("grievance_messages")
    .select("id, body, created_at, sender_id")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  // Attachments are read through the SAME RLS-bound client, which matters more
  // here than on the admin side: `grievance_attachments_select_scoped` and the
  // 0018 Storage read policy both restrict a requester to their own ticket, so a
  // customer cannot be handed a signed URL for anybody else's evidence even if
  // this query were later widened by mistake.
  const { data: attachments } = await supabase
    .from("grievance_attachments")
    .select("id, storage_path, message_id, created_at")
    .eq("ticket_id", ticketId);

  const signed = await signAttachmentPaths(
    supabase,
    (attachments ?? []).map((a) => ({
      id: a.id,
      storagePath: a.storage_path,
      createdAt: a.created_at,
    })),
  );
  const byMessage = new Map<string, SignedAttachment[]>();
  for (const a of attachments ?? []) {
    const entry = signed.find((s) => s.id === a.id);
    if (!entry) continue;
    const key = a.message_id ?? "";
    byMessage.set(key, [...(byMessage.get(key) ?? []), entry]);
  }

  const status: string = row.status;

  return {
    ...toRow(row),
    priority: row.priority,
    resolutionNote: row.resolution_note ?? null,
    closedAt: row.closed_at ?? null,
    reopenedCount: row.reopened_count ?? 0,
    canAttach: status !== "resolved" && status !== "closed",
    messages: (messages ?? []).map((m) => ({
      id: m.id,
      body: m.body,
      createdAt: m.created_at,
      // Anything not sent by the customer is a reply from UNI8 support. RLS has
      // already removed internal notes, so nothing here can be an agent's
      // private working note.
      fromSupport: m.sender_id !== customerId,
      attachments: byMessage.get(m.id) ?? [],
    })),
  };
}

export type OpenTicketForOrder = {
  id: string;
  ticketNo: number | null;
  category: Enums<"grievance_category">;
  status: Enums<"grievance_status">;
  createdAt: string;
};

/**
 * The live ticket a customer already has against one order, if any.
 *
 * This is the duplicate guard §59 requires ("duplicate automatic tickets must be
 * prevented"). Terminal tickets are excluded so a customer with a genuinely new
 * problem on an order that was resolved last week is not silently blocked — what
 * is prevented is a second ticket about the same live issue, which is what a
 * prompt shown on every page load would otherwise produce.
 */
export async function getOpenTicketForOrder(
  orderId: string,
  customerId: string
): Promise<OpenTicketForOrder | null> {
  const supabase = createServerSupabaseClient();

  const { data } = await supabase
    .from("grievance_tickets")
    .select("id, ticket_no, category, status, created_at")
    .eq("order_id", orderId)
    .eq("requester_id", customerId)
    .not("status", "in", "(resolved,closed)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    ticketNo: data.ticket_no ?? null,
    category: data.category,
    status: data.status,
    createdAt: data.created_at,
  };
}

/**
 * Batched form of the above for the order-group screen, which renders one card
 * per restaurant order and would otherwise fire N queries.
 */
export async function mapOpenTicketsForOrders(
  orderIds: string[],
  customerId: string
): Promise<Map<string, OpenTicketForOrder>> {
  const out = new Map<string, OpenTicketForOrder>();
  if (orderIds.length === 0) return out;

  const supabase = createServerSupabaseClient();

  const { data } = await supabase
    .from("grievance_tickets")
    .select("id, ticket_no, category, status, created_at, order_id")
    .in("order_id", orderIds)
    .eq("requester_id", customerId)
    .not("status", "in", "(resolved,closed)")
    .order("created_at", { ascending: false });

  for (const t of data ?? []) {
    if (!t.order_id || out.has(t.order_id)) continue; // newest wins
    out.set(t.order_id, {
      id: t.id,
      ticketNo: t.ticket_no ?? null,
      category: t.category,
      status: t.status,
      createdAt: t.created_at,
    });
  }

  return out;
}
