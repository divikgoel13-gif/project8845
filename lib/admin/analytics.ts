import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { REALIZED_SALE_STATUSES, IN_FLIGHT_STATUSES, isRealizedSale } from "@/lib/orders/status-groups";
import { campusIsoDate, toCampusTime, campusDayOfWeek } from "@/lib/scheduling/timezone";
import { evaluateSla } from "@/lib/grievance/sla";
import type { Database } from "@/types/database";

/**
 * Global Analytics (SRS Phase 9: "Global Analytics", "Restaurant comparison
 * analytics", "Platform GMV/order/AOV analytics", "Customer retention/repeat-
 * order metrics", "Pickup demand analytics", "Product performance analytics",
 * "Grievance performance analytics"; completion standard "Analytics reconcile
 * with source data").
 *
 * Every function here reads directly from source tables and aggregates
 * in-process, the same discipline lib/data/vendor-analytics.ts and
 * lib/admin/dashboard.ts already follow — no materialized view, no cached
 * rollup table that could silently drift from the ledger it summarises. A
 * platform whose analytics page cannot be reconciled against `orders` by hand
 * is exactly what §14 rules out.
 *
 * Definitions that recur across every function below, stated once:
 *
 *  - "GMV" is realized sales value: `subtotal_paise` summed over orders whose
 *    status ever reached `paid` (REALIZED_SALE_STATUSES). This is the same
 *    definition lib/orders/status-groups.ts documents as shared by the global
 *    dashboard, live ops, the orders list AND this module — four places that
 *    must agree, or the platform has four different numbers claiming to be
 *    "GMV".
 *  - All time-of-day/day-of-week bucketing uses `toCampusTime` /
 *    `campusDayOfWeek`, never a raw `Date` getter. lib/data/vendor-analytics.ts
 *    predates this discipline and buckets `pickupDemandByHour` by
 *    `getUTCHours()` directly (server-timezone-correct only because the
 *    server itself runs UTC) — this module does not repeat that shortcut.
 *  - Every aggregate that scans a capped row set exposes `truncated`. A
 *    Global Analytics page that prints a confident wrong number is worse than
 *    one that says "at least" — see Known Issue #18 on the Customer 360 page
 *    for the precedent this follows.
 */

// ── shared range handling ───────────────────────────────────────────────────

export const ANALYTICS_RANGE_DAYS = [7, 30, 90] as const;
export type AnalyticsRangeDays = (typeof ANALYTICS_RANGE_DAYS)[number];

export const DEFAULT_ANALYTICS_RANGE_DAYS: AnalyticsRangeDays = 30;

/** Parses the `?days=` query param; anything unrecognised falls back to 30. */
export function parseRangeDays(value: string | string[] | undefined): AnalyticsRangeDays {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? "", 10);
  return (ANALYTICS_RANGE_DAYS as readonly number[]).includes(parsed)
    ? (parsed as AnalyticsRangeDays)
    : DEFAULT_ANALYTICS_RANGE_DAYS;
}

/** The UTC instant `days` campus-days back from now, and the label used on every page. */
function rangeSinceIso(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

const ORDER_SCAN_CAP = 20_000;
const ITEM_SCAN_CAP = 20_000;
const TICKET_SCAN_CAP = 10_000;

type OrderRow = {
  id: string;
  restaurant_id: string;
  customer_id: string;
  status: string;
  subtotal_paise: number;
  created_at: string;
  pickup_time: string | null;
};

async function fetchPeriodOrders(
  sinceIso: string
): Promise<{ rows: OrderRow[]; truncated: boolean }> {
  const supabase = createServerSupabaseClient();
  const { data, count } = await supabase
    .from("orders")
    .select("id, restaurant_id, customer_id, status, subtotal_paise, created_at, pickup_time", {
      count: "exact",
    })
    .not("status", "in", "(cart)")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(ORDER_SCAN_CAP);

  const rows = data ?? [];
  return { rows, truncated: (count ?? rows.length) > rows.length };
}

// ── 1 & 2. Platform GMV / order / AOV analytics (page: /admin/analytics) ───

export type PlatformAnalytics = {
  rangeDays: number;
  totals: {
    gmvPaise: number;
    orderCount: number;
    aovPaise: number;
    commissionPaise: number;
    collectedCount: number;
    cancelledCount: number;
    noShowCount: number;
    /** Collected as a share of realized orders — did the food get picked up. */
    collectionRatePercent: number;
  };
  /** One row per campus day in range, oldest first — feeds TrendBars. */
  trend: { date: string; gmvPaise: number; orderCount: number }[];
  restaurantCount: { active: number; total: number };
  customerCount: number;
  truncated: boolean;
};

export async function getPlatformAnalytics(
  days: AnalyticsRangeDays,
  now: Date = new Date()
): Promise<PlatformAnalytics> {
  const supabase = createServerSupabaseClient();
  const sinceIso = rangeSinceIso(days, now);

  const [{ rows, truncated }, restaurantCounts, customerCount] = await Promise.all([
    fetchPeriodOrders(sinceIso),
    supabase.from("restaurants").select("status").is("archived_at", null).limit(2_000),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "customer"),
  ]);

  const realized = rows.filter((r) => isRealizedSale(r.status));
  const gmvPaise = realized.reduce((sum, r) => sum + r.subtotal_paise, 0);
  const orderCount = realized.length;
  const collectedCount = rows.filter((r) => r.status === "collected").length;
  const cancelledCount = rows.filter((r) => r.status === "cancelled").length;
  const noShowCount = rows.filter((r) => r.status === "no_show").length;

  // Commission isn't stored on every status (only orders that reached `paid`
  // ever get a snapshot), so this is read back from the source column rather
  // than recomputed from today's rate — §11.5/§23.
  const commissionPaise = await sumCommission(realized.map((r) => r.id));

  const buckets = new Map<string, { gmvPaise: number; orderCount: number }>();
  for (let i = days - 1; i >= 0; i -= 1) {
    buckets.set(campusIsoDate(new Date(now.getTime() - i * 86_400_000)), { gmvPaise: 0, orderCount: 0 });
  }
  for (const r of realized) {
    const key = campusIsoDate(new Date(r.created_at));
    const bucket = buckets.get(key);
    if (!bucket) continue; // outside the window after rounding — ignore
    bucket.gmvPaise += r.subtotal_paise;
    bucket.orderCount += 1;
  }

  const restaurants = restaurantCounts.data ?? [];

  return {
    rangeDays: days,
    totals: {
      gmvPaise,
      orderCount,
      aovPaise: orderCount > 0 ? Math.round(gmvPaise / orderCount) : 0,
      commissionPaise,
      collectedCount,
      cancelledCount,
      noShowCount,
      collectionRatePercent:
        orderCount > 0 ? Math.round((collectedCount / orderCount) * 100) : 0,
    },
    trend: Array.from(buckets.entries()).map(([date, v]) => ({ date, ...v })),
    restaurantCount: {
      active: restaurants.filter((r) => r.status === "active").length,
      total: restaurants.length,
    },
    customerCount: customerCount.count ?? 0,
    truncated,
  };
}

/**
 * Commission is stored per-order (`commission_amount_paise`), not derivable
 * from the rows already fetched by `fetchPeriodOrders` without widening that
 * select on every caller — this narrow follow-up query keeps the common path
 * (restaurant comparison, product performance) from paying for a column
 * nobody there needs.
 */
async function sumCommission(orderIds: string[]): Promise<number> {
  if (orderIds.length === 0) return 0;
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from("orders")
    .select("commission_amount_paise")
    .in("id", orderIds)
    .limit(ORDER_SCAN_CAP);
  return (data ?? []).reduce((sum, r) => sum + (r.commission_amount_paise ?? 0), 0);
}

// ── 3. Restaurant comparison analytics (page: /admin/analytics/restaurants) ─

export type RestaurantComparisonSort = "gmv" | "orders" | "aov" | "rating" | "tickets" | "collection_rate";

export type RestaurantComparisonRow = {
  restaurantId: string;
  name: string;
  slug: string;
  status: string;
  gmvPaise: number;
  orderCount: number;
  aovPaise: number;
  collectedCount: number;
  cancelledCount: number;
  noShowCount: number;
  collectionRatePercent: number;
  avgRating: number | null;
  ratingCount: number;
  /** Live backlog, not scoped to the date range — a current-state figure. */
  openTicketCount: number;
};

export type RestaurantComparison = {
  rangeDays: number;
  rows: RestaurantComparisonRow[];
  truncated: boolean;
};

export async function getRestaurantComparison(
  days: AnalyticsRangeDays,
  sort: RestaurantComparisonSort = "gmv",
  now: Date = new Date()
): Promise<RestaurantComparison> {
  const supabase = createServerSupabaseClient();
  const sinceIso = rangeSinceIso(days, now);

  const [{ rows, truncated }, restaurantRows, ratingRows, ticketRows] = await Promise.all([
    fetchPeriodOrders(sinceIso),
    supabase
      .from("restaurants")
      .select("id, name, slug, status")
      .is("archived_at", null)
      .limit(2_000),
    supabase.from("ratings").select("restaurant_id, stars").gte("created_at", sinceIso).limit(20_000),
    // Live backlog: every non-terminal ticket with a restaurant attached
    // (vendor-raised tickets and order-linked customer tickets both carry
    // restaurant_id). Not date-ranged — "open right now" is a current-state
    // figure, the same distinction lib/admin/dashboard.ts draws between
    // `today` and `now`.
    supabase
      .from("grievance_tickets")
      .select("restaurant_id")
      .not("status", "in", "(resolved,closed)")
      .not("restaurant_id", "is", null)
      .limit(10_000),
  ]);

  const restaurants = restaurantRows.data ?? [];
  const ratings = ratingRows.data ?? [];
  const tickets = ticketRows.data ?? [];

  const byRestaurant = new Map<
    string,
    { gmvPaise: number; orderCount: number; collected: number; cancelled: number; noShow: number }
  >();
  for (const r of restaurants) {
    byRestaurant.set(r.id, { gmvPaise: 0, orderCount: 0, collected: 0, cancelled: 0, noShow: 0 });
  }
  for (const row of rows) {
    const bucket = byRestaurant.get(row.restaurant_id);
    if (!bucket) continue; // archived mid-period — excluded from the comparison table
    if (isRealizedSale(row.status)) {
      bucket.gmvPaise += row.subtotal_paise;
      bucket.orderCount += 1;
      if (row.status === "collected") bucket.collected += 1;
    }
    if (row.status === "cancelled") bucket.cancelled += 1;
    if (row.status === "no_show") bucket.noShow += 1;
  }

  const ratingAgg = new Map<string, { sum: number; count: number }>();
  for (const r of ratings) {
    const existing = ratingAgg.get(r.restaurant_id) ?? { sum: 0, count: 0 };
    existing.sum += r.stars;
    existing.count += 1;
    ratingAgg.set(r.restaurant_id, existing);
  }

  const ticketCounts = new Map<string, number>();
  for (const t of tickets) {
    if (!t.restaurant_id) continue;
    ticketCounts.set(t.restaurant_id, (ticketCounts.get(t.restaurant_id) ?? 0) + 1);
  }

  const comparisonRows: RestaurantComparisonRow[] = restaurants.map((r) => {
    const agg = byRestaurant.get(r.id)!;
    const rating = ratingAgg.get(r.id);
    return {
      restaurantId: r.id,
      name: r.name,
      slug: r.slug,
      status: r.status,
      gmvPaise: agg.gmvPaise,
      orderCount: agg.orderCount,
      aovPaise: agg.orderCount > 0 ? Math.round(agg.gmvPaise / agg.orderCount) : 0,
      collectedCount: agg.collected,
      cancelledCount: agg.cancelled,
      noShowCount: agg.noShow,
      collectionRatePercent: agg.orderCount > 0 ? Math.round((agg.collected / agg.orderCount) * 100) : 0,
      avgRating: rating ? Math.round((rating.sum / rating.count) * 10) / 10 : null,
      ratingCount: rating?.count ?? 0,
      openTicketCount: ticketCounts.get(r.id) ?? 0,
    };
  });

  comparisonRows.sort((a, b) => compareRestaurantRows(a, b, sort));

  return { rangeDays: days, rows: comparisonRows, truncated };
}

function compareRestaurantRows(
  a: RestaurantComparisonRow,
  b: RestaurantComparisonRow,
  sort: RestaurantComparisonSort
): number {
  switch (sort) {
    case "orders":
      return b.orderCount - a.orderCount;
    case "aov":
      return b.aovPaise - a.aovPaise;
    case "rating":
      // Unrated restaurants sort last regardless of direction — a null
      // average is not "worse than zero stars", it is "no data yet".
      if (a.avgRating === null && b.avgRating === null) return 0;
      if (a.avgRating === null) return 1;
      if (b.avgRating === null) return -1;
      return b.avgRating - a.avgRating;
    case "tickets":
      return b.openTicketCount - a.openTicketCount;
    case "collection_rate":
      return b.collectionRatePercent - a.collectionRatePercent;
    case "gmv":
    default:
      return b.gmvPaise - a.gmvPaise;
  }
}

// ── 4. Customer retention / repeat-order metrics (/admin/analytics/retention) ─

export type RetentionMetrics = {
  rangeDays: number;
  /** Distinct customers with a realized order in the period. */
  activeCustomerCount: number;
  /** Their first-ever realized order (all-time) falls inside the period. */
  newCustomerCount: number;
  /** They had a realized order before the period started. */
  returningCustomerCount: number;
  returningSharePercent: number;
  /** How many realized orders each active customer placed IN THE PERIOD. */
  ordersPerCustomer: { label: string; count: number }[];
  truncated: boolean;
};

export async function getRetentionMetrics(
  days: AnalyticsRangeDays,
  now: Date = new Date()
): Promise<RetentionMetrics> {
  const supabase = createServerSupabaseClient();
  const sinceIso = rangeSinceIso(days, now);

  const { rows, truncated } = await fetchPeriodOrders(sinceIso);
  const realized = rows.filter((r) => isRealizedSale(r.status));

  const countsInPeriod = new Map<string, number>();
  for (const r of realized) {
    countsInPeriod.set(r.customer_id, (countsInPeriod.get(r.customer_id) ?? 0) + 1);
  }
  const customerIds = Array.from(countsInPeriod.keys());

  let newCustomerCount = 0;
  let returningCustomerCount = 0;

  if (customerIds.length > 0) {
    // All-time earliest realized order per customer, restricted to customers
    // active in this window — this is the one query in the module that looks
    // outside the range, deliberately: "new vs returning" is undefined without
    // knowing what happened before the window started.
    const { data: history } = await supabase
      .from("orders")
      .select("customer_id, created_at, status")
      .in("customer_id", customerIds)
      .in("status", REALIZED_SALE_STATUSES as unknown as string[])
      .order("created_at", { ascending: true })
      .limit(50_000);

    const firstOrderAt = new Map<string, string>();
    for (const row of history ?? []) {
      if (!firstOrderAt.has(row.customer_id)) firstOrderAt.set(row.customer_id, row.created_at);
    }

    for (const id of customerIds) {
      const first = firstOrderAt.get(id);
      if (first && first >= sinceIso) newCustomerCount += 1;
      else returningCustomerCount += 1;
    }
  }

  const buckets = { one: 0, two: 0, threeToFive: 0, sixPlus: 0 };
  for (const count of countsInPeriod.values()) {
    if (count === 1) buckets.one += 1;
    else if (count === 2) buckets.two += 1;
    else if (count <= 5) buckets.threeToFive += 1;
    else buckets.sixPlus += 1;
  }

  return {
    rangeDays: days,
    activeCustomerCount: customerIds.length,
    newCustomerCount,
    returningCustomerCount,
    returningSharePercent:
      customerIds.length > 0 ? Math.round((returningCustomerCount / customerIds.length) * 100) : 0,
    ordersPerCustomer: [
      { label: "1 order", count: buckets.one },
      { label: "2 orders", count: buckets.two },
      { label: "3–5 orders", count: buckets.threeToFive },
      { label: "6+ orders", count: buckets.sixPlus },
    ],
    truncated,
  };
}

// ── 5. Pickup demand analytics (/admin/analytics/pickup-demand) ────────────

export type PickupDemand = {
  /** Fixed forward-looking window — demand is about what's coming, not the
   *  selectable historical range every other tab uses. */
  windowDays: 7;
  totalUpcoming: number;
  byHour: { hour: number; count: number }[]; // 0-23, campus-local, always all 24
  byDayOfWeek: { day: number; label: string; count: number }[]; // 0=Sun..6=Sat
  topRestaurants: { restaurantId: string; name: string; count: number }[];
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export async function getPickupDemand(now: Date = new Date()): Promise<PickupDemand> {
  const supabase = createServerSupabaseClient();
  const sevenDaysAhead = new Date(now.getTime() + 7 * 86_400_000).toISOString();

  const { data } = await supabase
    .from("orders")
    .select("restaurant_id, pickup_time")
    .in("status", IN_FLIGHT_STATUSES as unknown as string[])
    .gte("pickup_time", now.toISOString())
    .lte("pickup_time", sevenDaysAhead)
    .limit(20_000);

  const rows = (data ?? []).filter((r): r is { restaurant_id: string; pickup_time: string } => Boolean(r.pickup_time));

  const hourCounts = new Map<number, number>();
  const dayCounts = new Map<number, number>();
  const restaurantCounts = new Map<string, number>();

  for (const row of rows) {
    const zoned = toCampusTime(new Date(row.pickup_time));
    const hour = zoned.getUTCHours();
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
    const day = campusDayOfWeek(new Date(row.pickup_time));
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    restaurantCounts.set(row.restaurant_id, (restaurantCounts.get(row.restaurant_id) ?? 0) + 1);
  }

  const restaurantIds = Array.from(restaurantCounts.keys());
  let names = new Map<string, string>();
  if (restaurantIds.length > 0) {
    const { data: restaurantRows } = await supabase
      .from("restaurants")
      .select("id, name")
      .in("id", restaurantIds);
    names = new Map((restaurantRows ?? []).map((r) => [r.id, r.name]));
  }

  const topRestaurants = Array.from(restaurantCounts.entries())
    .map(([restaurantId, count]) => ({ restaurantId, name: names.get(restaurantId) ?? "Unknown", count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    windowDays: 7,
    totalUpcoming: rows.length,
    byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, count: hourCounts.get(hour) ?? 0 })),
    byDayOfWeek: Array.from({ length: 7 }, (_, day) => ({
      day,
      // day is always 0..6 here (Array.from({ length: 7 }, (_, day) => ...)),
      // matching DAY_LABELS exactly.
      label: DAY_LABELS[day]!,
      count: dayCounts.get(day) ?? 0,
    })),
    topRestaurants,
  };
}

// ── 6. Product performance analytics (/admin/analytics/products) ──────────

export type ProductPerformanceSort = "quantity" | "revenue";

export type ProductPerformanceRow = {
  productId: string | null;
  name: string;
  restaurantId: string;
  restaurantName: string;
  quantitySold: number;
  revenuePaise: number;
};

export type ProductPerformance = {
  rangeDays: number;
  restaurantFilter: { id: string; name: string } | null;
  rows: ProductPerformanceRow[];
  truncated: boolean;
};

/**
 * order_items carries no restaurant_id of its own (SRS's snapshot model keeps
 * it to name/price/quantity), so restaurant scoping happens by first reading
 * the realized orders in range — optionally filtered to one restaurant — and
 * then reading only the items on those orders. Two round trips, but the
 * second is bounded by the first's result size rather than scanning
 * order_items platform-wide.
 */
export async function getProductPerformance(
  days: AnalyticsRangeDays,
  sort: ProductPerformanceSort = "quantity",
  restaurantId?: string,
  now: Date = new Date()
): Promise<ProductPerformance> {
  const supabase = createServerSupabaseClient();
  const sinceIso = rangeSinceIso(days, now);

  let orderQuery = supabase
    .from("orders")
    .select("id, restaurant_id", { count: "exact" })
    .in("status", REALIZED_SALE_STATUSES as unknown as string[])
    .gte("created_at", sinceIso)
    .limit(ORDER_SCAN_CAP);

  if (restaurantId) orderQuery = orderQuery.eq("restaurant_id", restaurantId);

  const { data: orderRows, count: orderCount } = await orderQuery;
  const orders = orderRows ?? [];
  let truncated = (orderCount ?? orders.length) > orders.length;

  let restaurantFilter: { id: string; name: string } | null = null;
  if (restaurantId) {
    const { data: r } = await supabase.from("restaurants").select("id, name").eq("id", restaurantId).maybeSingle();
    if (r) restaurantFilter = { id: r.id, name: r.name };
  }

  if (orders.length === 0) {
    return { rangeDays: days, restaurantFilter, rows: [], truncated };
  }

  const restaurantByOrder = new Map(orders.map((o) => [o.id, o.restaurant_id]));
  const orderIds = orders.map((o) => o.id);

  const { data: itemRows, count: itemCount } = await supabase
    .from("order_items")
    .select("order_id, product_id, name_snapshot, quantity, price_snapshot_paise", { count: "exact" })
    .in("order_id", orderIds)
    .limit(ITEM_SCAN_CAP);

  const items = itemRows ?? [];
  truncated = truncated || (itemCount ?? items.length) > items.length;

  const restaurantIds = Array.from(new Set(orders.map((o) => o.restaurant_id)));
  const { data: restaurantRows } = await supabase.from("restaurants").select("id, name").in("id", restaurantIds);
  const restaurantNames = new Map((restaurantRows ?? []).map((r) => [r.id, r.name]));

  // Grouped by (restaurant, product name) — the same product name at two
  // restaurants (e.g. "Masala Chai") must not be merged into one row.
  const byKey = new Map<string, ProductPerformanceRow>();
  for (const item of items) {
    const rId = restaurantByOrder.get(item.order_id);
    if (!rId) continue;
    const key = `${rId}::${item.product_id ?? item.name_snapshot}`;
    const existing = byKey.get(key) ?? {
      productId: item.product_id,
      name: item.name_snapshot,
      restaurantId: rId,
      restaurantName: restaurantNames.get(rId) ?? "Unknown",
      quantitySold: 0,
      revenuePaise: 0,
    };
    existing.quantitySold += item.quantity;
    existing.revenuePaise += item.quantity * item.price_snapshot_paise;
    byKey.set(key, existing);
  }

  const rows = Array.from(byKey.values()).sort((a, b) =>
    sort === "revenue" ? b.revenuePaise - a.revenuePaise : b.quantitySold - a.quantitySold
  );

  return { rangeDays: days, restaurantFilter, rows, truncated };
}

// ── 7. Grievance performance analytics (/admin/analytics/grievances) ──────

type GrievanceRow = Pick<
  Database["public"]["Tables"]["grievance_tickets"]["Row"],
  | "status"
  | "priority"
  | "category"
  | "requester_role"
  | "created_at"
  | "first_response_at"
  | "first_response_due_at"
  | "resolved_at"
  | "resolution_due_at"
  | "csat_score"
>;

export type GrievancePerformance = {
  rangeDays: number;
  totals: {
    created: number;
    resolved: number;
    closed: number;
    stillOpen: number;
    firstResponseMetPercent: number | null;
    resolutionMetPercent: number | null;
    avgResolutionMinutes: number | null;
    avgCsat: number | null;
    csatResponses: number;
    breachedOpenCount: number;
  };
  byCategory: { category: string; count: number }[];
  byPriority: { priority: string; count: number }[];
  /** Tickets created, bucketed by campus day — same shape as the GMV trend. */
  trend: { date: string; count: number }[];
  truncated: boolean;
};

export async function getGrievancePerformance(
  days: AnalyticsRangeDays,
  now: Date = new Date()
): Promise<GrievancePerformance> {
  const supabase = createServerSupabaseClient();
  const sinceIso = rangeSinceIso(days, now);

  const { data, count } = await supabase
    .from("grievance_tickets")
    .select(
      "status, priority, category, requester_role, created_at, first_response_at, first_response_due_at, resolved_at, resolution_due_at, csat_score",
      { count: "exact" }
    )
    .gte("created_at", sinceIso)
    .limit(TICKET_SCAN_CAP);

  const rows: GrievanceRow[] = data ?? [];
  const truncated = (count ?? rows.length) > rows.length;

  const byCategory = new Map<string, number>();
  const byPriority = new Map<string, number>();
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i -= 1) {
    buckets.set(campusIsoDate(new Date(now.getTime() - i * 86_400_000)), 0);
  }

  let resolved = 0;
  let closed = 0;
  let firstResponseEligible = 0;
  let firstResponseMet = 0;
  let resolutionEligible = 0;
  let resolutionMet = 0;
  let resolutionMinutesSum = 0;
  let resolutionMinutesCount = 0;
  let csatSum = 0;
  let csatResponses = 0;
  let breachedOpenCount = 0;

  for (const row of rows) {
    byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + 1);
    byPriority.set(row.priority, (byPriority.get(row.priority) ?? 0) + 1);

    const dayKey = campusIsoDate(new Date(row.created_at));
    if (buckets.has(dayKey)) buckets.set(dayKey, (buckets.get(dayKey) ?? 0) + 1);

    if (row.status === "resolved") resolved += 1;
    if (row.status === "closed") closed += 1;

    // SLA attainment is only meaningful for tickets whose clock has actually
    // stopped (a due date exists to be judged against) or which are still
    // live long enough to have bred a verdict — `evaluateSla` already
    // encodes exactly that asymmetry, so it is reused rather than
    // re-implemented here (see lib/grievance/sla.ts's own doc comment).
    const sla = evaluateSla({
      status: row.status,
      firstResponseAt: row.first_response_at,
      firstResponseDueAt: row.first_response_due_at,
      resolvedAt: row.resolved_at,
      resolutionDueAt: row.resolution_due_at,
    }, now);

    if (row.first_response_due_at) {
      firstResponseEligible += 1;
      if (sla.firstResponseMet) firstResponseMet += 1;
    }
    if (row.resolution_due_at && (row.resolved_at || sla.resolutionBreached)) {
      resolutionEligible += 1;
      if (sla.resolutionMet) resolutionMet += 1;
    }
    if (sla.breached && row.status !== "resolved" && row.status !== "closed") {
      breachedOpenCount += 1;
    }

    if (row.resolved_at) {
      const minutes = Math.round(
        (new Date(row.resolved_at).getTime() - new Date(row.created_at).getTime()) / 60_000
      );
      if (minutes >= 0) {
        resolutionMinutesSum += minutes;
        resolutionMinutesCount += 1;
      }
    }

    if (row.csat_score !== null) {
      csatSum += row.csat_score;
      csatResponses += 1;
    }
  }

  return {
    rangeDays: days,
    totals: {
      created: rows.length,
      resolved,
      closed,
      stillOpen: rows.filter((r) => r.status !== "resolved" && r.status !== "closed").length,
      firstResponseMetPercent:
        firstResponseEligible > 0 ? Math.round((firstResponseMet / firstResponseEligible) * 100) : null,
      resolutionMetPercent:
        resolutionEligible > 0 ? Math.round((resolutionMet / resolutionEligible) * 100) : null,
      avgResolutionMinutes:
        resolutionMinutesCount > 0 ? Math.round(resolutionMinutesSum / resolutionMinutesCount) : null,
      avgCsat: csatResponses > 0 ? Math.round((csatSum / csatResponses) * 10) / 10 : null,
      csatResponses,
      breachedOpenCount,
    },
    byCategory: Array.from(byCategory.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    byPriority: Array.from(byPriority.entries())
      .map(([priority, count]) => ({ priority, count }))
      .sort((a, b) => b.count - a.count),
    trend: Array.from(buckets.entries()).map(([date, count]) => ({ date, count })),
    truncated,
  };
}
