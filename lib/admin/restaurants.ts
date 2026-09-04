import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { campusDayBounds } from "@/lib/admin/dashboard";
import { ADMIN_PAGE_SIZE } from "@/components/ui/pagination";
import { IN_FLIGHT_STATUSES, REALIZED_SALE_STATUSES } from "@/lib/orders/status-groups";
import {
  restaurantOperationalState,
  type RestaurantLocationType,
  type RestaurantOperationalState,
  type RestaurantStatus,
} from "@/lib/restaurants/status";

/**
 * Restaurant directory for the Super Admin console (SRS §6, §29.1, V2.6 §60).
 *
 * The per-restaurant counters are computed with three bounded queries scoped to
 * the CURRENT PAGE's restaurant ids, then reduced in JS. One aggregate query per
 * row would be 25 round trips per page, and a database view would have to be
 * kept in step with the four-state vocabulary by hand.
 */

export type RestaurantListFilters = {
  /** `all` includes archived; the default deliberately does not. */
  status?: RestaurantStatus | "all";
  locationType?: RestaurantLocationType;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type RestaurantAdminRow = {
  id: string;
  name: string;
  slug: string;
  status: RestaurantStatus;
  /** What the UI shows: an elapsed timed pause reads as active (§G). */
  operationalState: RestaurantOperationalState;
  locationType: RestaurantLocationType;
  universityPlaceName: string | null;
  location: string | null;
  pausedUntil: string | null;
  pausedReason: string | null;
  closedReason: string | null;
  createdAt: string;
  archivedAt: string | null;
  activeProducts: number;
  ordersToday: number;
  inFlight: number;
  /** Earned but not yet disbursed, from `vendor_payables` (SRS §12). */
  outstandingPayablePaise: number;
};

export type RestaurantListResult = {
  rows: RestaurantAdminRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: { active: number; paused: number; closed: number; archived: number };
};

type RestaurantJoinRow = {
  id: string;
  name: string;
  slug: string;
  status: RestaurantStatus;
  location: string | null;
  location_type: RestaurantLocationType;
  university_place_name: string | null;
  paused_until: string | null;
  paused_reason: string | null;
  closed_reason: string | null;
  created_at: string;
  archived_at: string | null;
};

export async function listRestaurantsForAdmin(
  filters: RestaurantListFilters = {},
  now: Date = new Date()
): Promise<RestaurantListResult> {
  const supabase = createServerSupabaseClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? ADMIN_PAGE_SIZE;

  let query = supabase
    .from("restaurants")
    .select(
      `id, name, slug, status, location, location_type, university_place_name,
       paused_until, paused_reason, closed_reason, created_at, archived_at`,
      { count: "exact" }
    );

  // Archived restaurants are hidden by default rather than removed: §P forbids
  // deleting them, but a directory that leads with dead rows is unusable.
  if (!filters.status || filters.status === "all") {
    if (!filters.status) query = query.neq("status", "archived");
  } else {
    query = query.eq("status", filters.status);
  }

  if (filters.locationType) query = query.eq("location_type", filters.locationType);

  const search = filters.search?.trim();
  if (search) {
    query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%,location.ilike.%${search}%`);
  }

  const from = (page - 1) * pageSize;
  const { data, count } = await query
    .order("name", { ascending: true })
    .range(from, from + pageSize - 1);

  const base = (data ?? []) as unknown as RestaurantJoinRow[];
  const ids = base.map((r) => r.id);

  const [metrics, counts] = await Promise.all([
    ids.length > 0 ? restaurantMetrics(ids, now) : Promise.resolve(emptyMetrics()),
    statusCounts(),
  ]);

  const rows: RestaurantAdminRow[] = base.map((r) => {
    const m = metrics.get(r.id);
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      status: r.status,
      operationalState: restaurantOperationalState({ status: r.status, pausedUntil: r.paused_until }, now),
      locationType: r.location_type,
      universityPlaceName: r.university_place_name,
      location: r.location,
      pausedUntil: r.paused_until,
      pausedReason: r.paused_reason,
      closedReason: r.closed_reason,
      createdAt: r.created_at,
      archivedAt: r.archived_at,
      activeProducts: m?.activeProducts ?? 0,
      ordersToday: m?.ordersToday ?? 0,
      inFlight: m?.inFlight ?? 0,
      outstandingPayablePaise: m?.outstandingPayablePaise ?? 0,
    };
  });

  return { rows, total: count ?? 0, page, pageSize, counts };
}

type Metrics = {
  activeProducts: number;
  ordersToday: number;
  inFlight: number;
  outstandingPayablePaise: number;
};

function emptyMetrics(): Map<string, Metrics> {
  return new Map();
}

async function restaurantMetrics(ids: string[], now: Date): Promise<Map<string, Metrics>> {
  const supabase = createServerSupabaseClient();
  const { fromIso, toIso } = campusDayBounds(now);

  const [products, today, payables] = await Promise.all([
    supabase.from("products").select("restaurant_id").in("restaurant_id", ids).is("archived_at", null),
    // Today's campus-day orders, one query for the whole page. Only realized
    // statuses count as "orders today" so an abandoned cart never inflates it.
    supabase
      .from("orders")
      .select("restaurant_id, status")
      .in("restaurant_id", ids)
      .in("status", [...REALIZED_SALE_STATUSES])
      .gte("created_at", fromIso)
      .lt("created_at", toIso),
    supabase
      .from("vendor_payables")
      .select("restaurant_id, amount_paise, disbursed_amount_paise")
      .in("restaurant_id", ids),
  ]);

  const map = new Map<string, Metrics>();
  const get = (id: string): Metrics => {
    let m = map.get(id);
    if (!m) {
      m = { activeProducts: 0, ordersToday: 0, inFlight: 0, outstandingPayablePaise: 0 };
      map.set(id, m);
    }
    return m;
  };

  for (const p of (products.data ?? []) as { restaurant_id: string }[]) {
    get(p.restaurant_id).activeProducts += 1;
  }

  const inFlight = new Set<string>(IN_FLIGHT_STATUSES);
  for (const o of (today.data ?? []) as { restaurant_id: string; status: string }[]) {
    const m = get(o.restaurant_id);
    m.ordersToday += 1;
    if (inFlight.has(o.status)) m.inFlight += 1;
  }

  for (const v of (payables.data ?? []) as {
    restaurant_id: string;
    amount_paise: number;
    disbursed_amount_paise: number;
  }[]) {
    get(v.restaurant_id).outstandingPayablePaise += v.amount_paise - v.disbursed_amount_paise;
  }

  return map;
}

/**
 * Filter-chip counts. Read from a single status projection rather than four
 * `count` queries, because the chips must add up to the same total the list
 * reports — four independent counts taken microseconds apart do not.
 */
async function statusCounts() {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase.from("restaurants").select("status").limit(5_000);
  const counts = { active: 0, paused: 0, closed: 0, archived: 0 };
  for (const r of (data ?? []) as { status: RestaurantStatus }[]) {
    if (r.status in counts) counts[r.status as keyof typeof counts] += 1;
  }
  return counts;
}

/**
 * Lightweight `{id, name}` list for the restaurant filter dropdowns on the
 * global orders, payments and analytics pages. Archived restaurants are included
 * because their historical orders are still searchable.
 */
export async function listRestaurantOptions(): Promise<{ id: string; name: string; status: RestaurantStatus }[]> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from("restaurants")
    .select("id, name, status")
    .order("name", { ascending: true })
    .limit(2_000);
  return (data ?? []) as { id: string; name: string; status: RestaurantStatus }[];
}
