import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ADMIN_PAGE_SIZE } from "@/components/ui/pagination";
import type { RestaurantStatus } from "@/lib/restaurants/status";

/**
 * Readers for the fourteen §5.3 restaurant workspace pages that no existing
 * module already covers.
 *
 * Where a Phase 3–5 vendor reader already answers the question — orders, menu,
 * payables, disbursements, grievances, analytics — the workspace page reuses it
 * rather than getting a near-duplicate here. Those readers are all RLS-bound and
 * take a `restaurantId`, and a super admin's `*_select_*` policies already return
 * every row, so reuse is exact rather than approximate. Duplicating them would
 * mean two definitions of "GMV" in one console.
 *
 * What is here is the set of things only the Super Admin console touches:
 * access grants, the pickup schedule as a whole, the walking-time row for one
 * restaurant, ratings in aggregate, and the restaurant-scoped audit slice.
 */

/* ── Access grants (SRS §8, §11 five-staff cap) ─────────────────────────── */

export type AccessGrant = {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  /** `profiles.status` — the platform-wide suspension switch, not a per-grant one. */
  profileStatus: "active" | "disabled";
  role: "vendor_admin" | "staff";
  createdAt: string;
  disabledAt: string | null;
};

type GrantRow = {
  id: string;
  user_id: string;
  created_at: string;
  disabled_at: string | null;
  profiles: { name: string | null; email: string | null; phone: string | null; status: string } | null;
};

function toGrant(row: GrantRow, role: "vendor_admin" | "staff"): AccessGrant {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.profiles?.name ?? null,
    email: row.profiles?.email ?? null,
    phone: row.profiles?.phone ?? null,
    profileStatus: row.profiles?.status === "disabled" ? "disabled" : "active",
    role,
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
  };
}

/**
 * Both grant tables, read with the same shape. `disabled_at` rows are RETURNED:
 * §8 and §P require revocation to be reversible and auditable, so a revoked
 * grant stays visible with its date rather than vanishing — otherwise "was this
 * person ever given access" is only answerable from the audit log.
 */
export async function listRestaurantAccess(
  restaurantId: string
): Promise<{ vendorAdmins: AccessGrant[]; staff: AccessGrant[] }> {
  const supabase = createServerSupabaseClient();
  const columns = "id, user_id, created_at, disabled_at, profiles(name, email, phone, status)";

  const [admins, staff] = await Promise.all([
    supabase
      .from("vendor_admin_memberships")
      .select(columns)
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: true }),
    supabase
      .from("restaurant_staff")
      .select(columns)
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: true }),
  ]);

  return {
    vendorAdmins: ((admins.data ?? []) as unknown as GrantRow[]).map((r) => toGrant(r, "vendor_admin")),
    staff: ((staff.data ?? []) as unknown as GrantRow[]).map((r) => toGrant(r, "staff")),
  };
}

/**
 * Candidates for a new grant. Restricted to profiles that already hold the role
 * being granted: the console grants ACCESS, it does not change what someone is.
 * Promoting a customer to vendor_admin by side effect of a scoping form is how a
 * role model stops meaning anything.
 */
export async function listGrantCandidates(
  role: "vendor_admin" | "staff",
  search?: string
): Promise<{ id: string; name: string | null; email: string | null; phone: string | null }[]> {
  const supabase = createServerSupabaseClient();
  let query = supabase
    .from("profiles")
    .select("id, name, email, phone")
    .eq("role", role)
    .eq("status", "active")
    .order("name", { ascending: true })
    .limit(200);

  const term = search?.trim();
  if (term) query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);

  const { data } = await query;
  return (data ?? []) as { id: string; name: string | null; email: string | null; phone: string | null }[];
}

/* ── Pickup schedule (SRS §9, §10.4) ────────────────────────────────────── */

export type DayHours = {
  dayOfWeek: number;
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
};

export type HourException = {
  id: string;
  exceptionDate: string;
  isClosed: boolean;
  opensAt: string | null;
  closesAt: string | null;
  note: string | null;
};

export type CapacityOverride = {
  id: string;
  dayOfWeek: number | null;
  specificDate: string | null;
  slotStart: string;
  capacity: number;
};

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/**
 * The whole schedule in one read, always seven day rows.
 *
 * A missing `restaurant_hours` row and a row with `is_closed = true` mean the
 * same thing to `resolveOpenWindow`, but they look different in a table, so the
 * seven days are materialised here. An operator should never have to infer
 * "Sunday is closed" from Sunday's absence.
 */
export async function getPickupSchedule(restaurantId: string): Promise<{
  hours: DayHours[];
  exceptions: HourException[];
  overrides: CapacityOverride[];
}> {
  const supabase = createServerSupabaseClient();
  const todayIso = new Date().toISOString().slice(0, 10);

  const [hours, exceptions, overrides] = await Promise.all([
    supabase
      .from("restaurant_hours")
      .select("day_of_week, opens_at, closes_at, is_closed")
      .eq("restaurant_id", restaurantId),
    // Past exceptions are dropped: a closed day from last term is noise, and
    // §P only protects operational and financial history, not schedule hints.
    supabase
      .from("restaurant_hour_exceptions")
      .select("id, exception_date, is_closed, opens_at, closes_at, note")
      .eq("restaurant_id", restaurantId)
      .gte("exception_date", todayIso)
      .order("exception_date", { ascending: true })
      .limit(200),
    supabase
      .from("pickup_capacity_overrides")
      .select("id, day_of_week, specific_date, slot_start, capacity")
      .eq("restaurant_id", restaurantId)
      .order("slot_start", { ascending: true })
      .limit(500),
  ]);

  const byDay = new Map<number, DayHours>();
  for (const h of (hours.data ?? []) as {
    day_of_week: number;
    opens_at: string | null;
    closes_at: string | null;
    is_closed: boolean;
  }[]) {
    byDay.set(h.day_of_week, {
      dayOfWeek: h.day_of_week,
      opensAt: h.opens_at,
      closesAt: h.closes_at,
      isClosed: h.is_closed,
    });
  }

  return {
    hours: DAY_NAMES.map((_, day) => byDay.get(day) ?? { dayOfWeek: day, opensAt: null, closesAt: null, isClosed: true }),
    exceptions: ((exceptions.data ?? []) as unknown as {
      id: string;
      exception_date: string;
      is_closed: boolean;
      opens_at: string | null;
      closes_at: string | null;
      note: string | null;
    }[]).map((e) => ({
      id: e.id,
      exceptionDate: e.exception_date,
      isClosed: e.is_closed,
      opensAt: e.opens_at,
      closesAt: e.closes_at,
      note: e.note,
    })),
    overrides: ((overrides.data ?? []) as unknown as {
      id: string;
      day_of_week: number | null;
      specific_date: string | null;
      slot_start: string;
      capacity: number;
    }[]).map((o) => ({
      id: o.id,
      dayOfWeek: o.day_of_week,
      specificDate: o.specific_date,
      slotStart: o.slot_start,
      capacity: o.capacity,
    })),
  };
}

/* ── Walking times (SRS §2, §9, V2.6 §U) ────────────────────────────────── */

export type WalkingTimeRow = {
  otherId: string;
  otherName: string;
  otherStatus: RestaurantStatus;
  /** Minutes FROM this restaurant TO the other, null if never configured. */
  outboundMinutes: number | null;
  /** Minutes back. Stored directionally, so the two can legitimately differ. */
  inboundMinutes: number | null;
};

/**
 * One restaurant's row and column of the walking-time matrix.
 *
 * Both directions are shown because the table stores them independently: campus
 * geography can be asymmetric (a one-way gate, a stairwell), and a UI that showed
 * one number would silently hide a missing reverse entry. A missing entry is not
 * zero — `getWalkingTimeMinutes` falls back to the reverse edge, and to nothing
 * at all when neither direction exists — so null is rendered as "not set" rather
 * than as a number.
 */
export async function listWalkingTimesFor(restaurantId: string): Promise<WalkingTimeRow[]> {
  const supabase = createServerSupabaseClient();

  const [others, edges] = await Promise.all([
    supabase
      .from("restaurants")
      .select("id, name, status")
      .neq("id", restaurantId)
      .neq("status", "archived")
      .order("name", { ascending: true })
      .limit(500),
    supabase
      .from("walking_times")
      .select("restaurant_from_id, restaurant_to_id, minutes")
      .or(`restaurant_from_id.eq.${restaurantId},restaurant_to_id.eq.${restaurantId}`)
      .limit(2000),
  ]);

  const outbound = new Map<string, number>();
  const inbound = new Map<string, number>();
  for (const e of (edges.data ?? []) as {
    restaurant_from_id: string;
    restaurant_to_id: string;
    minutes: number;
  }[]) {
    if (e.restaurant_from_id === restaurantId) outbound.set(e.restaurant_to_id, e.minutes);
    if (e.restaurant_to_id === restaurantId) inbound.set(e.restaurant_from_id, e.minutes);
  }

  return ((others.data ?? []) as { id: string; name: string; status: RestaurantStatus }[]).map((o) => ({
    otherId: o.id,
    otherName: o.name,
    otherStatus: o.status,
    outboundMinutes: outbound.get(o.id) ?? null,
    inboundMinutes: inbound.get(o.id) ?? null,
  }));
}

/* ── Ratings (SRS §10 "Ratings", §13) ───────────────────────────────────── */

export type RatingRow = {
  id: string;
  orderId: string;
  stars: number;
  comment: string | null;
  createdAt: string;
  customerName: string | null;
};

export type RatingsSummary = {
  count: number;
  averageStars: number | null;
  /** Index 0 = one star. */
  distribution: [number, number, number, number, number];
  withComments: number;
};

/**
 * Ratings are read in full (capped) and aggregated in process, matching the
 * approach in `lib/data/vendor-analytics.ts`. At campus scale one restaurant has
 * hundreds, not millions, and the alternative — a database view — would have to
 * be maintained alongside every change to what "average" means here.
 *
 * The average is over ALL ratings, not the page shown. A page-local average is a
 * number that changes when you paginate, which is worse than no number.
 */
export async function listRestaurantRatings(
  restaurantId: string,
  limit = 100
): Promise<{ rows: RatingRow[]; summary: RatingsSummary }> {
  const supabase = createServerSupabaseClient();

  const { data } = await supabase
    .from("ratings")
    .select("id, order_id, stars, comment, created_at, profiles(name)")
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false })
    .limit(Math.max(limit, 1000));

  const all = (data ?? []) as unknown as {
    id: string;
    order_id: string;
    stars: number;
    comment: string | null;
    created_at: string;
    profiles: { name: string | null } | null;
  }[];

  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let total = 0;
  let withComments = 0;
  for (const r of all) {
    // Clamped to 1..5, so index is always 0..4 — a valid position in the
    // fixed 5-tuple above.
    const index = (Math.min(5, Math.max(1, r.stars)) - 1) as 0 | 1 | 2 | 3 | 4;
    distribution[index] += 1;
    total += r.stars;
    if (r.comment?.trim()) withComments += 1;
  }

  return {
    rows: all.slice(0, limit).map((r) => ({
      id: r.id,
      orderId: r.order_id,
      stars: r.stars,
      comment: r.comment,
      createdAt: r.created_at,
      customerName: r.profiles?.name ?? null,
    })),
    summary: {
      count: all.length,
      averageStars: all.length > 0 ? Math.round((total / all.length) * 100) / 100 : null,
      distribution,
      withComments,
    },
  };
}

/* ── Restaurant-scoped audit slice (SRS §18) ────────────────────────────── */

export type WorkspaceAuditRow = {
  id: string;
  action: string;
  actorName: string | null;
  actorRole: string | null;
  targetTable: string | null;
  targetId: string | null;
  reason: string | null;
  createdAt: string;
};

/**
 * `audit_logs.restaurant_id` is denormalised precisely so this view is one
 * indexed query rather than a union over target tables. Everything that writes
 * to the log passes it through `recordAuditEvent`, which is the only reason this
 * page can be trusted to be complete.
 *
 * Read-only by construction: there is no update or delete path anywhere in the
 * codebase, per §18 and §P.
 */
export async function listRestaurantAuditLog(
  restaurantId: string,
  options: { page?: number; pageSize?: number; action?: string } = {}
): Promise<{ rows: WorkspaceAuditRow[]; total: number; page: number; pageSize: number }> {
  const supabase = createServerSupabaseClient();
  const page = Math.max(1, options.page ?? 1);
  const pageSize = options.pageSize ?? ADMIN_PAGE_SIZE;
  const from = (page - 1) * pageSize;

  let query = supabase
    .from("audit_logs")
    .select("id, action, actor_role, target_table, target_id, reason, created_at, profiles(name)", {
      count: "exact",
    })
    .eq("restaurant_id", restaurantId);

  // Prefix match, so `restaurant.` selects every lifecycle event without the
  // filter needing to enumerate the action vocabulary.
  const action = options.action?.trim();
  if (action) query = query.ilike("action", `${action}%`);

  const { data, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  const rows = ((data ?? []) as unknown as {
    id: string;
    action: string;
    actor_role: string | null;
    target_table: string | null;
    target_id: string | null;
    reason: string | null;
    created_at: string;
    profiles: { name: string | null } | null;
  }[]).map((r) => ({
    id: r.id,
    action: r.action,
    actorName: r.profiles?.name ?? null,
    actorRole: r.actor_role,
    targetTable: r.target_table,
    targetId: r.target_id,
    reason: r.reason,
    createdAt: r.created_at,
  }));

  return { rows, total: count ?? 0, page, pageSize };
}
