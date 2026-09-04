import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ADMIN_PAGE_SIZE } from "@/components/ui/pagination";

/**
 * Global Staff & Access centre (SRS §8, §4 role table, §5.1 sidebar,
 * V2.6 §54; Phase 9 "Global Staff & Access centre").
 *
 * The restaurant workspace's own Staff and Vendor Admins pages
 * (`lib/admin/restaurant-workspace.ts`'s `listRestaurantAccess`) already do
 * everything this module does for ONE restaurant, and do it well — this is
 * not a rewrite of that reader. What Phase 7 could not offer is the reverse
 * question: "where does this person have access, across every restaurant,
 * without me first knowing which restaurant to open". That is what a
 * *centre* means here — one directory, one search box, spanning both grant
 * tables and every restaurant, with the same mutations
 * (`lib/actions/admin/restaurant-access.ts`) reused rather than duplicated.
 *
 * One row per GRANT, not per person. A vendor admin holding access at two
 * restaurants appears as two rows, because that mirrors the schema exactly —
 * there is no single "access" row spanning restaurants to collapse into one
 * — and because each row must stay independently revocable, the same way
 * `AccessRowActions` already expects.
 *
 * Read in full and filtered/paginated in process, the same discipline
 * `lib/admin/analytics.ts` and `lib/data/vendor-analytics.ts` already use:
 * at campus scale, total grants across the whole platform are in the
 * hundreds, not millions, and a is_super_admin() RLS policy already returns
 * every row to this reader in one shot.
 */

export type StaffAccessRole = "vendor_admin" | "staff";

export type StaffAccessRow = {
  grantId: string;
  userId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: StaffAccessRole;
  /** `profiles.status` — platform-wide, not specific to this one grant. */
  profileStatus: "active" | "disabled";
  restaurantId: string;
  restaurantName: string;
  grantedAt: string;
  /** This grant's own revocation, independent of every other grant this person holds. */
  disabledAt: string | null;
};

type RawGrantRow = {
  id: string;
  user_id: string;
  restaurant_id: string;
  created_at: string;
  disabled_at: string | null;
  profiles: { name: string | null; email: string | null; phone: string | null; status: string } | null;
  restaurants: { name: string } | null;
};

const GRANT_SCAN_CAP = 5_000;

async function fetchAllGrants(): Promise<{ rows: StaffAccessRow[]; truncated: boolean }> {
  const supabase = createServerSupabaseClient();
  const columns =
    "id, user_id, restaurant_id, created_at, disabled_at, profiles(name, email, phone, status), restaurants(name)";

  const [admins, staff] = await Promise.all([
    supabase
      .from("vendor_admin_memberships")
      .select(columns, { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(GRANT_SCAN_CAP),
    supabase
      .from("restaurant_staff")
      .select(columns, { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(GRANT_SCAN_CAP),
  ]);

  const toRow = (r: RawGrantRow, role: StaffAccessRole): StaffAccessRow => ({
    grantId: r.id,
    userId: r.user_id,
    name: r.profiles?.name ?? null,
    email: r.profiles?.email ?? null,
    phone: r.profiles?.phone ?? null,
    role,
    profileStatus: r.profiles?.status === "disabled" ? "disabled" : "active",
    restaurantId: r.restaurant_id,
    restaurantName: r.restaurants?.name ?? "Unknown restaurant",
    grantedAt: r.created_at,
    disabledAt: r.disabled_at,
  });

  const adminRows = ((admins.data ?? []) as unknown as RawGrantRow[]).map((r) => toRow(r, "vendor_admin"));
  const staffRows = ((staff.data ?? []) as unknown as RawGrantRow[]).map((r) => toRow(r, "staff"));

  const truncated =
    (admins.count ?? adminRows.length) > adminRows.length || (staff.count ?? staffRows.length) > staffRows.length;

  return { rows: [...adminRows, ...staffRows], truncated };
}

export type StaffAccessFilters = {
  search?: string;
  role?: StaffAccessRole | "all";
  status?: "active" | "disabled" | "all";
  restaurantId?: string;
  page?: number;
};

export async function listStaffAccessDirectory(
  filters: StaffAccessFilters = {}
): Promise<{ rows: StaffAccessRow[]; total: number; page: number; pageSize: number; truncated: boolean }> {
  const { rows: allRows, truncated } = await fetchAllGrants();

  const term = filters.search?.trim().toLowerCase();
  const role = filters.role && filters.role !== "all" ? filters.role : null;
  const status = filters.status && filters.status !== "all" ? filters.status : null;

  let filtered = allRows;
  if (role) filtered = filtered.filter((r) => r.role === role);
  if (status) filtered = filtered.filter((r) => r.profileStatus === status);
  if (filters.restaurantId) filtered = filtered.filter((r) => r.restaurantId === filters.restaurantId);
  if (term) {
    filtered = filtered.filter(
      (r) =>
        r.name?.toLowerCase().includes(term) ||
        r.email?.toLowerCase().includes(term) ||
        r.phone?.toLowerCase().includes(term) ||
        r.restaurantName.toLowerCase().includes(term)
    );
  }

  // Active grants first, then newest-granted — an operator scanning the
  // directory is almost always looking for who currently has access, not
  // who used to.
  filtered = [...filtered].sort((a, b) => {
    if (Boolean(a.disabledAt) !== Boolean(b.disabledAt)) return a.disabledAt ? 1 : -1;
    return new Date(b.grantedAt).getTime() - new Date(a.grantedAt).getTime();
  });

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = ADMIN_PAGE_SIZE;
  const start = (page - 1) * pageSize;

  return {
    rows: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    pageSize,
    truncated,
  };
}

export type StaffAccessOverview = {
  /** Distinct PEOPLE, not grants — a vendor admin at two restaurants counts once. */
  vendorAdminCount: number;
  staffCount: number;
  platformDisabledCount: number;
  /** Active (non-archived, non-paused-forever) restaurants with zero active staff grants. */
  restaurantsWithNoActiveStaff: { restaurantId: string; name: string }[];
  truncated: boolean;
};

export async function getStaffAccessOverview(): Promise<StaffAccessOverview> {
  const supabase = createServerSupabaseClient();
  const [{ rows, truncated }, restaurantRows] = await Promise.all([
    fetchAllGrants(),
    supabase.from("restaurants").select("id, name").is("archived_at", null).limit(2_000),
  ]);

  const activeStaffByRestaurant = new Set<string>();
  const vendorAdminIds = new Set<string>();
  const staffIds = new Set<string>();
  const disabledProfileIds = new Set<string>();

  for (const r of rows) {
    if (r.role === "vendor_admin") vendorAdminIds.add(r.userId);
    else staffIds.add(r.userId);
    if (r.profileStatus === "disabled") disabledProfileIds.add(r.userId);
    if (r.role === "staff" && !r.disabledAt) activeStaffByRestaurant.add(r.restaurantId);
  }

  const restaurants = restaurantRows.data ?? [];
  const restaurantsWithNoActiveStaff = restaurants
    .filter((r) => !activeStaffByRestaurant.has(r.id))
    .map((r) => ({ restaurantId: r.id, name: r.name }));

  return {
    vendorAdminCount: vendorAdminIds.size,
    staffCount: staffIds.size,
    platformDisabledCount: disabledProfileIds.size,
    restaurantsWithNoActiveStaff,
    truncated,
  };
}
