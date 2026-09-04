import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { campusDayBounds } from "@/lib/admin/dashboard";
import { ADMIN_PAGE_SIZE } from "@/components/ui/pagination";
import {
  REALIZED_SALE_STATUSES,
  IN_FLIGHT_STATUSES,
  type OrderStatus,
} from "@/lib/orders/status-groups";

/**
 * Global cross-restaurant order search (SRS §6, §13).
 *
 * Every money field here is read from the order's SNAPSHOT columns
 * (`commission_rate_snapshot`, `commission_amount_paise`, `vendor_payable_paise`)
 * rather than recomputed — SRS §11.5 and §23 require that changing the
 * commission setting never alters a historical order.
 *
 * Filters are all optional and all derived from the URL query string so a
 * filtered view is linkable (the reason `listGlobalOrders` takes plain strings
 * rather than richer types: the caller has just parsed `searchParams`).
 */

export type OrderListFilters = {
  status?: OrderStatus | "all" | "realized" | "in_flight";
  restaurantId?: string;
  customerId?: string;
  /** Campus dates, inclusive, `YYYY-MM-DD`. */
  fromDate?: string;
  toDate?: string;
  /** Matches an order id prefix, a customer name, or a customer email. */
  search?: string;
  page?: number;
  pageSize?: number;
};

export type OrderListRow = {
  id: string;
  status: OrderStatus;
  createdAt: string;
  pickupTime: string | null;
  collectedAt: string | null;
  restaurantId: string;
  restaurantName: string;
  customerId: string;
  customerName: string | null;
  customerEmail: string | null;
  subtotalPaise: number;
  commissionAmountPaise: number | null;
  vendorPayablePaise: number | null;
  itemCount: number;
  groupId: string | null;
};

export type OrderListResult = {
  rows: OrderListRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Totals across the WHOLE filtered set, not just the current page. */
  totals: { realizedGmvPaise: number; realizedCount: number; commissionPaise: number };
};

type OrderJoinRow = {
  id: string;
  status: OrderStatus;
  created_at: string;
  pickup_time: string | null;
  collected_at: string | null;
  restaurant_id: string;
  customer_id: string;
  subtotal_paise: number;
  commission_amount_paise: number | null;
  vendor_payable_paise: number | null;
  group_id: string | null;
  restaurants: { name: string } | null;
  profiles: { name: string | null; email: string | null } | null;
  order_items: { quantity: number }[] | null;
};

/**
 * The status filter accepts the two synthetic buckets as well as a single
 * concrete status, because "show me everything that counts as a sale" is the
 * question an operator actually asks, and expressing it as five checkboxes
 * invites one of them to be left unticked by accident.
 *
 * Returned as a `{ column, op, value }` descriptor rather than applied inside a
 * helper: PostgREST's builder returns a differently-typed object from every
 * filter call, so a generic "apply a filter" helper can only be written with
 * casts that would hide a real mistake.
 */
function statusFilter(status: OrderListFilters["status"]):
  | { kind: "in"; values: OrderStatus[] }
  | { kind: "eq"; value: OrderStatus }
  | { kind: "notCart" } {
  if (!status || status === "all") return { kind: "notCart" };
  if (status === "realized") return { kind: "in", values: [...REALIZED_SALE_STATUSES] };
  if (status === "in_flight") return { kind: "in", values: [...IN_FLIGHT_STATUSES] };
  return { kind: "eq", value: status };
}

export async function listGlobalOrders(filters: OrderListFilters = {}): Promise<OrderListResult> {
  const supabase = createServerSupabaseClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? ADMIN_PAGE_SIZE;

  let query = supabase
    .from("orders")
    .select(
      `id, status, created_at, pickup_time, collected_at, restaurant_id, customer_id,
       subtotal_paise, commission_amount_paise, vendor_payable_paise, group_id,
       restaurants ( name ),
       profiles!orders_customer_id_fkey ( name, email ),
       order_items ( quantity )`,
      { count: "exact" }
    );

  const sf = statusFilter(filters.status);
  // `cart` is not an order yet — it is an abandoned basket, and including it
  // would inflate the row count of every unfiltered view.
  if (sf.kind === "notCart") query = query.not("status", "eq", "cart");
  else if (sf.kind === "in") query = query.in("status", sf.values);
  else query = query.eq("status", sf.value);

  if (filters.restaurantId) query = query.eq("restaurant_id", filters.restaurantId);
  if (filters.customerId) query = query.eq("customer_id", filters.customerId);

  // Date bounds are CAMPUS days converted to UTC instants. Filtering on the raw
  // date would cut the day over at 05:30 local and split the evening peak.
  if (filters.fromDate) {
    query = query.gte("created_at", campusDayBounds(new Date(`${filters.fromDate}T12:00:00Z`)).fromIso);
  }
  if (filters.toDate) {
    query = query.lt("created_at", campusDayBounds(new Date(`${filters.toDate}T12:00:00Z`)).toIso);
  }

  // A uuid prefix is the fastest thing an operator has to hand from a customer
  // ("my order starts 3f2a"). Name/email search is a separate lookup because
  // PostgREST cannot `or` across an embedded resource.
  const search = filters.search?.trim();
  if (search) {
    if (/^[0-9a-f-]{4,}$/i.test(search)) {
      query = query.ilike("id", `${search}%`);
    } else {
      const { data: matches } = await supabase
        .from("profiles")
        .select("id")
        .or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`)
        .limit(200);
      const ids = (matches ?? []).map((m) => m.id as string);
      // An empty `in ()` is invalid, so short-circuit to a guaranteed-empty page
      // rather than silently dropping the filter and showing everything.
      if (ids.length === 0) {
        return {
          rows: [],
          total: 0,
          page,
          pageSize,
          totals: { realizedGmvPaise: 0, realizedCount: 0, commissionPaise: 0 },
        };
      }
      query = query.in("customer_id", ids);
    }
  }

  const from = (page - 1) * pageSize;
  const { data, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  const rows: OrderListRow[] = ((data ?? []) as unknown as OrderJoinRow[]).map((o) => ({
    id: o.id,
    status: o.status,
    createdAt: o.created_at,
    pickupTime: o.pickup_time,
    collectedAt: o.collected_at,
    restaurantId: o.restaurant_id,
    restaurantName: o.restaurants?.name ?? "Unknown restaurant",
    customerId: o.customer_id,
    customerName: o.profiles?.name ?? null,
    customerEmail: o.profiles?.email ?? null,
    subtotalPaise: o.subtotal_paise,
    commissionAmountPaise: o.commission_amount_paise,
    vendorPayablePaise: o.vendor_payable_paise,
    itemCount: (o.order_items ?? []).reduce((sum, i) => sum + i.quantity, 0),
    groupId: o.group_id,
  }));

  const totals = await filteredTotals(filters);

  return { rows, total: count ?? 0, page, pageSize, totals };
}

/**
 * Footer totals for the filtered set. A second query rather than summing the
 * page, because a per-page total that changes as you paginate is worse than no
 * total at all — someone will screenshot page 2 and call it the day's revenue.
 */
async function filteredTotals(filters: OrderListFilters) {
  const supabase = createServerSupabaseClient();
  let query = supabase
    .from("orders")
    .select("status, subtotal_paise, commission_amount_paise")
    .in("status", [...REALIZED_SALE_STATUSES])
    .limit(50_000);

  if (filters.restaurantId) query = query.eq("restaurant_id", filters.restaurantId);
  if (filters.customerId) query = query.eq("customer_id", filters.customerId);
  if (filters.fromDate) {
    query = query.gte("created_at", campusDayBounds(new Date(`${filters.fromDate}T12:00:00Z`)).fromIso);
  }
  if (filters.toDate) {
    query = query.lt("created_at", campusDayBounds(new Date(`${filters.toDate}T12:00:00Z`)).toIso);
  }

  const { data } = await query;
  let realizedGmvPaise = 0;
  let commissionPaise = 0;
  for (const row of (data ?? []) as { subtotal_paise: number; commission_amount_paise: number | null }[]) {
    realizedGmvPaise += row.subtotal_paise;
    commissionPaise += row.commission_amount_paise ?? 0;
  }
  return { realizedGmvPaise, realizedCount: (data ?? []).length, commissionPaise };
}

/* ─────────────────────────────────────────────────────────────────────────
   Order detail (SRS §6, §13, §16)
   ───────────────────────────────────────────────────────────────────────── */

export type AdminOrderDetail = {
  id: string;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  pickupTime: string | null;
  readyAt: string | null;
  readySource: "manual" | "auto" | null;
  collectedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelledByName: string | null;
  noShowAt: string | null;
  groupId: string | null;

  restaurant: { id: string; name: string; status: string; locationType: string };
  customer: { id: string; name: string | null; email: string | null; phone: string | null };

  /** All paise. Read from the order's own snapshot columns, never recomputed. */
  money: {
    subtotalPaise: number;
    commissionRateSnapshot: number | null;
    commissionAmountPaise: number | null;
    vendorPayablePaise: number | null;
    cancelPenaltyRate: number | null;
    cancelPenaltyAmountPaise: number | null;
  };

  items: { id: string; nameSnapshot: string; pricePaise: number; quantity: number; lineTotalPaise: number }[];

  /** Payment is joined through `group_id`: a multi-restaurant checkout is ONE payment. */
  payment: {
    id: string;
    status: string;
    amountPaise: number;
    razorpayOrderId: string | null;
    razorpayPaymentId: string | null;
    createdAt: string;
  } | null;
  /** Sibling orders in the same checkout group, so the shared payment reconciles. */
  siblings: { id: string; restaurantName: string; status: OrderStatus; subtotalPaise: number }[];

  refunds: {
    id: string;
    amountPaise: number;
    status: string;
    razorpayRefundId: string | null;
    createdAt: string;
    grievanceTicketId: string | null;
  }[];

  grievances: { id: string; ticketNo: number | null; category: string; status: string; priority: string; createdAt: string }[];
  auditTrail: { id: string; action: string; actorRole: string | null; createdAt: string }[];
};

export async function getOrderDetailForAdmin(orderId: string): Promise<AdminOrderDetail | null> {
  const supabase = createServerSupabaseClient();

  const { data: order } = await supabase
    .from("orders")
    .select(
      `id, status, created_at, updated_at, pickup_time, ready_at, ready_source, collected_at,
       cancelled_at, cancel_reason, cancelled_by, no_show_at, group_id,
       subtotal_paise, commission_rate_snapshot, commission_amount_paise, vendor_payable_paise,
       cancel_penalty_rate, cancel_penalty_amount_paise,
       restaurant_id, customer_id,
       restaurants ( id, name, status, location_type ),
       profiles!orders_customer_id_fkey ( id, name, email, phone ),
       order_items ( id, name_snapshot, price_snapshot_paise, quantity )`
    )
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return null;
  const o = order as unknown as OrderDetailRow;

  // Six independent lookups that all hang off the order; none depends on
  // another's result, so they go in one round of parallel queries.
  const [cancelledBy, payment, siblings, refunds, grievances, audit] = await Promise.all([
    o.cancelled_by
      ? supabase.from("profiles").select("name").eq("id", o.cancelled_by).maybeSingle()
      : Promise.resolve({ data: null }),
    o.group_id
      ? supabase
          .from("payments")
          .select("id, status, amount_paise, razorpay_order_id, razorpay_payment_id, created_at")
          .eq("group_id", o.group_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    o.group_id
      ? supabase
          .from("orders")
          .select("id, status, subtotal_paise, restaurants ( name )")
          .eq("group_id", o.group_id)
          .neq("id", orderId)
      : Promise.resolve({ data: [] }),
    supabase
      .from("refund_events")
      .select("id, amount_paise, status, razorpay_refund_id, created_at, grievance_ticket_id")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true }),
    supabase
      .from("grievance_tickets")
      .select("id, ticket_no, category, status, priority, created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false }),
    // §18: the order's own audit slice. Read-only here — `audit_logs` has no
    // write path outside `recordAuditEvent`.
    supabase
      .from("audit_logs")
      .select("id, action, actor_role, created_at")
      .eq("target_table", "orders")
      .eq("target_id", orderId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const items = (o.order_items ?? []).map((i) => ({
    id: i.id,
    nameSnapshot: i.name_snapshot,
    pricePaise: i.price_snapshot_paise,
    quantity: i.quantity,
    lineTotalPaise: i.price_snapshot_paise * i.quantity,
  }));

  return {
    id: o.id,
    status: o.status,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
    pickupTime: o.pickup_time,
    readyAt: o.ready_at,
    readySource: o.ready_source,
    collectedAt: o.collected_at,
    cancelledAt: o.cancelled_at,
    cancelReason: o.cancel_reason,
    cancelledByName: (cancelledBy.data as { name: string | null } | null)?.name ?? null,
    noShowAt: o.no_show_at,
    groupId: o.group_id,

    restaurant: {
      id: o.restaurants?.id ?? o.restaurant_id,
      name: o.restaurants?.name ?? "Unknown restaurant",
      status: o.restaurants?.status ?? "unknown",
      locationType: o.restaurants?.location_type ?? "outside_university",
    },
    customer: {
      id: o.profiles?.id ?? o.customer_id,
      name: o.profiles?.name ?? null,
      email: o.profiles?.email ?? null,
      phone: o.profiles?.phone ?? null,
    },

    money: {
      subtotalPaise: o.subtotal_paise,
      commissionRateSnapshot: o.commission_rate_snapshot,
      commissionAmountPaise: o.commission_amount_paise,
      vendorPayablePaise: o.vendor_payable_paise,
      cancelPenaltyRate: o.cancel_penalty_rate,
      cancelPenaltyAmountPaise: o.cancel_penalty_amount_paise,
    },

    items,

    payment: payment.data
      ? {
          id: (payment.data as PaymentRow).id,
          status: (payment.data as PaymentRow).status,
          amountPaise: (payment.data as PaymentRow).amount_paise,
          razorpayOrderId: (payment.data as PaymentRow).razorpay_order_id,
          razorpayPaymentId: (payment.data as PaymentRow).razorpay_payment_id,
          createdAt: (payment.data as PaymentRow).created_at,
        }
      : null,

    siblings: ((siblings.data ?? []) as unknown as SiblingRow[]).map((s) => ({
      id: s.id,
      restaurantName: s.restaurants?.name ?? "Unknown restaurant",
      status: s.status,
      subtotalPaise: s.subtotal_paise,
    })),

    refunds: ((refunds.data ?? []) as RefundRow[]).map((r) => ({
      id: r.id,
      amountPaise: r.amount_paise,
      status: r.status,
      razorpayRefundId: r.razorpay_refund_id,
      createdAt: r.created_at,
      grievanceTicketId: r.grievance_ticket_id,
    })),

    grievances: ((grievances.data ?? []) as GrievanceRow[]).map((g) => ({
      id: g.id,
      ticketNo: g.ticket_no,
      category: g.category,
      status: g.status,
      priority: g.priority,
      createdAt: g.created_at,
    })),

    auditTrail: ((audit.data ?? []) as AuditRow[]).map((a) => ({
      id: a.id,
      action: a.action,
      actorRole: a.actor_role,
      createdAt: a.created_at,
    })),
  };
}

type OrderDetailRow = {
  id: string;
  status: OrderStatus;
  created_at: string;
  updated_at: string;
  pickup_time: string | null;
  ready_at: string | null;
  ready_source: "manual" | "auto" | null;
  collected_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  cancelled_by: string | null;
  no_show_at: string | null;
  group_id: string | null;
  subtotal_paise: number;
  commission_rate_snapshot: number | null;
  commission_amount_paise: number | null;
  vendor_payable_paise: number | null;
  cancel_penalty_rate: number | null;
  cancel_penalty_amount_paise: number | null;
  restaurant_id: string;
  customer_id: string;
  restaurants: { id: string; name: string; status: string; location_type: string } | null;
  profiles: { id: string; name: string | null; email: string | null; phone: string | null } | null;
  order_items: { id: string; name_snapshot: string; price_snapshot_paise: number; quantity: number }[] | null;
};

type PaymentRow = {
  id: string;
  status: string;
  amount_paise: number;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  created_at: string;
};
type SiblingRow = { id: string; status: OrderStatus; subtotal_paise: number; restaurants: { name: string } | null };
type RefundRow = {
  id: string;
  amount_paise: number;
  status: string;
  razorpay_refund_id: string | null;
  created_at: string;
  grievance_ticket_id: string | null;
};
type GrievanceRow = {
  id: string;
  ticket_no: number | null;
  category: string;
  status: string;
  priority: string;
  created_at: string;
};
type AuditRow = { id: string; action: string; actor_role: string | null; created_at: string };
