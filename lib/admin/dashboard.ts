import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCommissionRate } from "@/lib/platform/settings";
import { IN_FLIGHT_STATUSES, REALIZED_SALE_STATUSES } from "@/lib/orders/status-groups";
import { campusIsoDate, fromCampusTime } from "@/lib/scheduling/timezone";

/**
 * Global Super Admin dashboard aggregation (SRS Phase 7 deliverable "Global
 * Super Admin Dashboard"; §14 analytics accuracy).
 *
 * Three decisions that shape everything below:
 *
 * 1. "Today" is a CAMPUS day, not a UTC day. A UTC-bounded "today" would cut
 *    over at 05:30 local, so the 06:00 breakfast rush would land in yesterday's
 *    figures and the evening peak would be split across two dashboard days.
 *    `campusDayBounds` converts a campus calendar date to the UTC instants that
 *    bracket it, and every "today" query below uses that pair.
 *
 * 2. Financial figures are read from the SNAPSHOT columns on `orders`
 *    (commission_amount_paise, vendor_payable_paise), never recomputed from the
 *    current commission rate. §11.5 and §23 require that changing the rate does
 *    not rewrite historical financials, so a dashboard that multiplied today's
 *    GMV by today's rate would disagree with the ledger the moment the rate
 *    changed mid-day. The current rate is shown as a separate, clearly labelled
 *    tile — it is configuration, not a derived total.
 *
 * 3. Counts use `count: "exact", head: true` rather than fetching rows. The
 *    global dashboard has no row-level content to show, so pulling 20,000 order
 *    rows to length them is pure waste; the trend series is the one place rows
 *    are genuinely needed, and it is bounded to 14 days.
 *
 * Read through the RLS-bound client: `requireRole("super_admin")` in the layout
 * and page has already run, and super admin select policies cover every table
 * touched here, so there is nothing that needs the service role.
 */

/** The UTC instants bracketing one campus calendar day, `[from, to)`. */
export function campusDayBounds(date: Date = new Date()): { fromIso: string; toIso: string; isoDate: string } {
  const isoDate = campusIsoDate(date);
  // campusIsoDate always returns "YYYY-MM-DD" (see lib/scheduling/timezone.ts),
  // so split("-") always yields exactly 3 numeric parts.
  const parts = isoDate.split("-").map(Number);
  const [y, m, d] = parts as [number, number, number];
  const start = fromCampusTime(new Date(Date.UTC(y, m - 1, d, 0, 0, 0)));
  const end = fromCampusTime(new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0)));
  return { fromIso: start.toISOString(), toIso: end.toISOString(), isoDate };
}

export type GlobalDashboard = {
  /** Today, campus time. */
  today: {
    gmvPaise: number;
    orderCount: number;
    aovPaise: number;
    commissionPaise: number;
    vendorPayablePaise: number;
    collectedCount: number;
    cancelledCount: number;
    noShowCount: number;
  };
  /** Live, not day-bounded. */
  now: {
    inFlightCount: number;
    inFlightValuePaise: number;
    pickupsNextHour: number;
    overduePickups: number;
  };
  platform: {
    activeRestaurants: number;
    pausedRestaurants: number;
    closedRestaurants: number;
    archivedRestaurants: number;
    insideUniversityRestaurants: number;
    customers: number;
    newCustomersToday: number;
  };
  finance: {
    /** Lifetime vendor payable not yet disbursed. */
    outstandingPayablePaise: number;
    payoutsAwaitingAck: number;
    commissionRate: number;
  };
  support: {
    openTickets: number;
    urgentOrHighOpen: number;
    unassignedOpen: number;
    openFraudFlags: number;
  };
  /** Last 14 campus days, oldest first. */
  gmvTrend: { date: string; gmvPaise: number; orderCount: number }[];
};

type TrendOrderRow = {
  status: string;
  subtotal_paise: number;
  commission_amount_paise: number | null;
  vendor_payable_paise: number | null;
  created_at: string;
};

export async function getGlobalDashboard(now: Date = new Date()): Promise<GlobalDashboard> {
  const supabase = createServerSupabaseClient();
  const { fromIso: todayFrom, toIso: todayTo } = campusDayBounds(now);

  // 14 campus days back, inclusive of today — the trend window.
  const trendFrom = campusDayBounds(new Date(now.getTime() - 13 * 86_400_000)).fromIso;
  const nextHour = new Date(now.getTime() + 60 * 60_000).toISOString();
  const nowIso = now.toISOString();

  const [
    trendOrders,
    inFlight,
    pickupsNextHour,
    overduePickups,
    restaurantRows,
    customerCount,
    newCustomers,
    payables,
    payoutsAwaitingAck,
    openTickets,
    urgentOrHighOpen,
    unassignedOpen,
    openFraudFlags,
    commissionRate,
  ] = await Promise.all([
    supabase
      .from("orders")
      .select("status, subtotal_paise, commission_amount_paise, vendor_payable_paise, created_at")
      .gte("created_at", trendFrom)
      .not("status", "in", "(cart)")
      .limit(20_000),
    supabase
      .from("orders")
      .select("subtotal_paise")
      .in("status", IN_FLIGHT_STATUSES as unknown as string[])
      .limit(5_000),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .in("status", IN_FLIGHT_STATUSES as unknown as string[])
      .gte("pickup_time", nowIso)
      .lte("pickup_time", nextHour),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .in("status", IN_FLIGHT_STATUSES as unknown as string[])
      .lt("pickup_time", nowIso),
    supabase.from("restaurants").select("status, location_type, archived_at").limit(2_000),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "customer"),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "customer")
      .gte("created_at", todayFrom)
      .lt("created_at", todayTo),
    supabase.from("vendor_payables").select("amount_paise, disbursed_amount_paise").limit(20_000),
    supabase.from("disbursements").select("id", { count: "exact", head: true }).eq("status", "paid"),
    supabase
      .from("grievance_tickets")
      .select("id", { count: "exact", head: true })
      .not("status", "in", "(resolved,closed)"),
    supabase
      .from("grievance_tickets")
      .select("id", { count: "exact", head: true })
      .not("status", "in", "(resolved,closed)")
      .in("priority", ["urgent", "high"]),
    supabase
      .from("grievance_tickets")
      .select("id", { count: "exact", head: true })
      .not("status", "in", "(resolved,closed)")
      .is("assignee_id", null),
    supabase.from("fraud_flags").select("id", { count: "exact", head: true }).eq("status", "open"),
    getCommissionRate(),
  ]);

  const rows: TrendOrderRow[] = trendOrders.data ?? [];

  // ── today ────────────────────────────────────────────────────────────────
  const todayRows = rows.filter((r) => r.created_at >= todayFrom && r.created_at < todayTo);
  const todayRealized = todayRows.filter((r) =>
    (REALIZED_SALE_STATUSES as readonly string[]).includes(r.status)
  );

  const gmvPaise = todayRealized.reduce((sum, r) => sum + r.subtotal_paise, 0);
  const orderCount = todayRealized.length;

  // ── trend ────────────────────────────────────────────────────────────────
  // Bucketed by the CAMPUS date of created_at, which is why this cannot be a
  // plain `created_at.slice(0, 10)` — that would bucket by UTC date and shift
  // every order placed before 05:30 into the previous day.
  const buckets = new Map<string, { gmvPaise: number; orderCount: number }>();
  for (let i = 13; i >= 0; i -= 1) {
    buckets.set(campusIsoDate(new Date(now.getTime() - i * 86_400_000)), { gmvPaise: 0, orderCount: 0 });
  }
  for (const row of rows) {
    if (!(REALIZED_SALE_STATUSES as readonly string[]).includes(row.status)) continue;
    const key = campusIsoDate(new Date(row.created_at));
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.gmvPaise += row.subtotal_paise;
    bucket.orderCount += 1;
  }

  const restaurants = restaurantRows.data ?? [];
  const payableRows = payables.data ?? [];

  return {
    today: {
      gmvPaise,
      orderCount,
      aovPaise: orderCount > 0 ? Math.round(gmvPaise / orderCount) : 0,
      commissionPaise: todayRealized.reduce((sum, r) => sum + (r.commission_amount_paise ?? 0), 0),
      vendorPayablePaise: todayRealized.reduce((sum, r) => sum + (r.vendor_payable_paise ?? 0), 0),
      collectedCount: todayRows.filter((r) => r.status === "collected").length,
      cancelledCount: todayRows.filter((r) => r.status === "cancelled").length,
      noShowCount: todayRows.filter((r) => r.status === "no_show").length,
    },
    now: {
      inFlightCount: (inFlight.data ?? []).length,
      inFlightValuePaise: (inFlight.data ?? []).reduce((sum, r) => sum + r.subtotal_paise, 0),
      pickupsNextHour: pickupsNextHour.count ?? 0,
      overduePickups: overduePickups.count ?? 0,
    },
    platform: {
      // Counted from the stored column, not the derived operational state: an
      // elapsed timed pause still reads 'paused' in the database until someone
      // resumes it, and the live-ops page is where that nuance belongs.
      activeRestaurants: restaurants.filter((r) => r.status === "active").length,
      pausedRestaurants: restaurants.filter((r) => r.status === "paused").length,
      closedRestaurants: restaurants.filter((r) => r.status === "closed").length,
      archivedRestaurants: restaurants.filter((r) => r.status === "archived").length,
      insideUniversityRestaurants: restaurants.filter(
        (r) => r.location_type === "inside_university" && r.status !== "archived"
      ).length,
      customers: customerCount.count ?? 0,
      newCustomersToday: newCustomers.count ?? 0,
    },
    finance: {
      outstandingPayablePaise: payableRows.reduce(
        (sum, p) => sum + (p.amount_paise - p.disbursed_amount_paise),
        0
      ),
      // 'paid' means UNI8 has sent the money and is waiting for the vendor to
      // acknowledge receipt (SRS §12) — an open loop, not a completed payout.
      payoutsAwaitingAck: payoutsAwaitingAck.count ?? 0,
      commissionRate,
    },
    support: {
      openTickets: openTickets.count ?? 0,
      urgentOrHighOpen: urgentOrHighOpen.count ?? 0,
      unassignedOpen: unassignedOpen.count ?? 0,
      openFraudFlags: openFraudFlags.count ?? 0,
    },
    gmvTrend: Array.from(buckets.entries()).map(([date, v]) => ({ date, ...v })),
  };
}
