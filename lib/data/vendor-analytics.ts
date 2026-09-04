import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Vendor Admin analytics (SRS Phase 4, §10 Dashboard row: "GMV, orders,
 * AOV, upcoming pickups, collected/pending, sales trend, pickup demand,
 * top products and alerts"; Analytics row: "GMV trend; orders trend; AOV;
 * orders by pickup period; top products; collected vs cancelled/no-show;
 * repeat-customer share"). Per docs/ARCHITECTURE.md: "Analytics:
 * server-side aggregations/reporting queries; no full-table browser
 * analytics" — rows are fetched here (server-side, RLS-bound to the
 * caller's restaurant scope) and aggregated in-process rather than in a
 * client component, which satisfies that principle at this system's
 * scale without standing up materialized views for a campus-scale order
 * volume.
 *
 * Two judgment calls worth being explicit about, the same way
 * docs/PAYMENTS.md documents its QR-fallback reasoning:
 *
 * 1. "GMV" here means realized sales value (subtotal_paise summed over
 *    orders that actually reached a paid state: paid, scheduled,
 *    preparing, ready_for_pickup, collected). Cancelled/refunded/no_show
 *    orders are deliberately excluded from GMV and tracked separately
 *    (see `collectedVsCancelled`) — otherwise a cancelled order would be
 *    double-counted as both a "sale" and a "cancellation."
 * 2. There is no dedicated `paid_at` timestamp on `orders` (only
 *    `created_at`, which is set at checkout/payment_pending, and
 *    `updated_at`, which changes on every later status transition too).
 *    Trends here are bucketed by `created_at` as the pragmatic stand-in
 *    for "when the sale happened" — close enough for a campus ordering
 *    system's cadence, but genuinely imprecise for orders that took a
 *    long time to move from payment_pending to paid. Worth a real
 *    `paid_at` column in a later migration if this precision ever
 *    matters.
 */

const REALIZED_SALE_STATUSES = ["paid", "scheduled", "preparing", "ready_for_pickup", "collected"] as const;

type OrderRow = {
  id: string;
  status: string;
  subtotal_paise: number;
  created_at: string;
  pickup_time: string | null;
  customer_id: string;
};

export type VendorDashboardMetrics = {
  gmvPaise: number;
  orderCount: number;
  aovPaise: number;
  upcomingPickupCount: number;
  collectedCount: number;
  pendingCount: number; // paid/scheduled/preparing/ready_for_pickup, not yet collected
  outstandingPaise: number; // value of pendingCount orders
  salesTrend: { date: string; gmvPaise: number }[]; // last 14 days
  pickupDemandByHour: { hour: number; count: number }[]; // upcoming, next 7 days
  topProducts: { name: string; quantitySold: number; revenuePaise: number }[];
  alerts: { type: "out_of_stock" | "overdue_pickup"; count: number; message: string }[];
};

export type VendorAnalytics = VendorDashboardMetrics & {
  ordersTrend: { date: string; count: number }[]; // last 30 days
  collectedVsCancelled: { collected: number; cancelled: number; noShow: number };
  repeatCustomerSharePercent: number;
};

async function fetchRealizedOrders(restaurantId: string, sinceIso: string): Promise<OrderRow[]> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from("orders")
    .select("id, status, subtotal_paise, created_at, pickup_time, customer_id")
    .eq("restaurant_id", restaurantId)
    .neq("status", "payment_pending")
    .gte("created_at", sinceIso)
    .limit(5000);
  return data ?? [];
}

function dayKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

export async function getVendorDashboardMetrics(restaurantId: string): Promise<VendorDashboardMetrics> {
  const supabase = createServerSupabaseClient();
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const [orders, upcoming, outOfStockCount] = await Promise.all([
    fetchRealizedOrders(restaurantId, fourteenDaysAgo),
    supabase
      .from("orders")
      .select("id, pickup_time, status, subtotal_paise")
      .eq("restaurant_id", restaurantId)
      .in("status", ["paid", "scheduled", "preparing", "ready_for_pickup"])
      .gte("pickup_time", now.toISOString())
      .lte("pickup_time", sevenDaysAhead),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .eq("availability", "out_of_stock")
      .is("archived_at", null),
  ]);

  const realized = orders.filter((o) => REALIZED_SALE_STATUSES.includes(o.status as (typeof REALIZED_SALE_STATUSES)[number]));
  const gmvPaise = realized.reduce((sum, o) => sum + o.subtotal_paise, 0);
  const orderCount = realized.length;
  const aovPaise = orderCount > 0 ? Math.round(gmvPaise / orderCount) : 0;

  const collectedCount = realized.filter((o) => o.status === "collected").length;
  const pendingOrders = realized.filter((o) => o.status !== "collected");
  const pendingCount = pendingOrders.length;
  const outstandingPaise = pendingOrders.reduce((sum, o) => sum + o.subtotal_paise, 0);

  const trendMap = new Map<string, number>();
  for (const o of realized) {
    const key = dayKey(o.created_at);
    trendMap.set(key, (trendMap.get(key) ?? 0) + o.subtotal_paise);
  }
  const salesTrend = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now.getTime() - (13 - i) * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    return { date: key, gmvPaise: trendMap.get(key) ?? 0 };
  });

  const upcomingOrders = upcoming.data ?? [];
  const hourMap = new Map<number, number>();
  for (const o of upcomingOrders) {
    if (!o.pickup_time) continue;
    const hour = new Date(o.pickup_time).getUTCHours();
    hourMap.set(hour, (hourMap.get(hour) ?? 0) + 1);
  }
  const pickupDemandByHour = Array.from(hourMap.entries())
    .map(([hour, count]) => ({ hour, count }))
    .sort((a, b) => a.hour - b.hour);

  const orderIds = realized.map((o) => o.id);
  let topProducts: VendorDashboardMetrics["topProducts"] = [];
  if (orderIds.length > 0) {
    const { data: items } = await supabase
      .from("order_items")
      .select("name_snapshot, quantity, price_snapshot_paise, order_id")
      .in("order_id", orderIds);

    const byName = new Map<string, { quantitySold: number; revenuePaise: number }>();
    for (const item of items ?? []) {
      const existing = byName.get(item.name_snapshot) ?? { quantitySold: 0, revenuePaise: 0 };
      existing.quantitySold += item.quantity;
      existing.revenuePaise += item.price_snapshot_paise * item.quantity;
      byName.set(item.name_snapshot, existing);
    }
    topProducts = Array.from(byName.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.quantitySold - a.quantitySold)
      .slice(0, 5);
  }

  const alerts: VendorDashboardMetrics["alerts"] = [];
  const oosCount = outOfStockCount.count ?? 0;
  if (oosCount > 0) {
    alerts.push({
      type: "out_of_stock",
      count: oosCount,
      message: `${oosCount} product${oosCount === 1 ? "" : "s"} marked out of stock.`,
    });
  }
  const overdueCount = pendingOrders.filter(
    (o) => o.status === "ready_for_pickup" && o.pickup_time && new Date(o.pickup_time).getTime() < now.getTime() - 30 * 60 * 1000
  ).length;
  if (overdueCount > 0) {
    alerts.push({
      type: "overdue_pickup",
      count: overdueCount,
      message: `${overdueCount} order${overdueCount === 1 ? "" : "s"} ready and unclaimed 30+ minutes past pickup time.`,
    });
  }

  return {
    gmvPaise,
    orderCount,
    aovPaise,
    upcomingPickupCount: upcomingOrders.length,
    collectedCount,
    pendingCount,
    outstandingPaise,
    salesTrend,
    pickupDemandByHour,
    topProducts,
    alerts,
  };
}

export async function getVendorAnalytics(restaurantId: string): Promise<VendorAnalytics> {
  const dashboard = await getVendorDashboardMetrics(restaurantId);

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const orders = await fetchRealizedOrders(restaurantId, thirtyDaysAgo);

  const allStatusOrdersTrendMap = new Map<string, number>();
  for (const o of orders) {
    const key = dayKey(o.created_at);
    allStatusOrdersTrendMap.set(key, (allStatusOrdersTrendMap.get(key) ?? 0) + 1);
  }
  const ordersTrend = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now.getTime() - (29 - i) * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    return { date: key, count: allStatusOrdersTrendMap.get(key) ?? 0 };
  });

  const collectedVsCancelled = {
    collected: orders.filter((o) => o.status === "collected").length,
    cancelled: orders.filter((o) => o.status === "cancelled" || o.status === "refunded" || o.status === "refund_pending").length,
    noShow: orders.filter((o) => o.status === "no_show").length,
  };

  // Repeat-customer share: among distinct customers who placed a
  // successfully-paid order in the last 30 days, what fraction have EVER
  // placed more than one successfully-paid order with this restaurant
  // (i.e. this wasn't their only order). See file-level doc comment for
  // why this specific definition was chosen.
  const realizedInWindow = orders.filter((o) => REALIZED_SALE_STATUSES.includes(o.status as (typeof REALIZED_SALE_STATUSES)[number]));
  const customerIdsInWindow = Array.from(new Set(realizedInWindow.map((o) => o.customer_id)));

  let repeatCustomerSharePercent = 0;
  if (customerIdsInWindow.length > 0) {
    const supabase = createServerSupabaseClient();
    const { data: allTimeOrders } = await supabase
      .from("orders")
      .select("customer_id, status")
      .eq("restaurant_id", restaurantId)
      .in("customer_id", customerIdsInWindow)
      .in("status", REALIZED_SALE_STATUSES as unknown as string[]);

    const countByCustomer = new Map<string, number>();
    for (const o of allTimeOrders ?? []) {
      countByCustomer.set(o.customer_id, (countByCustomer.get(o.customer_id) ?? 0) + 1);
    }
    const repeatCount = customerIdsInWindow.filter((id) => (countByCustomer.get(id) ?? 0) > 1).length;
    repeatCustomerSharePercent = Math.round((repeatCount / customerIdsInWindow.length) * 100);
  }

  return {
    ...dashboard,
    ordersTrend,
    collectedVsCancelled,
    repeatCustomerSharePercent,
  };
}
