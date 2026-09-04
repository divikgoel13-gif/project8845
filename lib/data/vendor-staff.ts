import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type VendorStaffMember = {
  userId: string;
  name: string | null;
  email: string | null;
  createdAt: string;
  disabledAt: string | null;
  recentActivity: { action: string; createdAt: string }[];
};

/**
 * Staff list + recent activity for the Vendor Admin "Manage Staff" page
 * (SRS §10: "...view activity"). RLS-bound client —
 * `restaurant_staff_select_own_or_scoped` already permits an active
 * vendor admin to see their restaurant's staff rows (SRS §17), and
 * `audit_logs_select_scoped` permits the restaurant-scoped slice of the
 * audit log, which doubles as a simple activity feed here rather than
 * building a separate activity-tracking table.
 */
export async function listRestaurantStaff(restaurantId: string): Promise<VendorStaffMember[]> {
  const supabase = createServerSupabaseClient();

  const { data: memberships } = await supabase
    .from("restaurant_staff")
    .select("user_id, created_at, disabled_at, profiles(name, email)")
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: true });

  if (!memberships || memberships.length === 0) return [];

  const userIds = memberships.map((m) => m.user_id);

  const { data: activity } = await supabase
    .from("audit_logs")
    .select("actor_id, action, created_at")
    .eq("restaurant_id", restaurantId)
    .in("actor_id", userIds)
    .order("created_at", { ascending: false })
    .limit(200);

  const activityByActor = new Map<string, { action: string; createdAt: string }[]>();
  for (const entry of activity ?? []) {
    if (!entry.actor_id) continue;
    const list = activityByActor.get(entry.actor_id) ?? [];
    if (list.length < 5) list.push({ action: entry.action, createdAt: entry.created_at });
    activityByActor.set(entry.actor_id, list);
  }

  return memberships.map((m) => {
    const profile = (m as unknown as { profiles: { name: string | null; email: string | null } | null }).profiles;
    return {
      userId: m.user_id,
      name: profile?.name ?? null,
      email: profile?.email ?? null,
      createdAt: m.created_at,
      disabledAt: m.disabled_at,
      recentActivity: activityByActor.get(m.user_id) ?? [],
    };
  });
}
