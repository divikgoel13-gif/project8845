import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AuthenticatedProfile } from "@/lib/auth/roles";

export type MyRestaurant = { id: string; name: string };

/**
 * Restaurants the current vendor_admin/staff user has an ACTIVE
 * membership for — used to populate restaurant selectors on scan/dashboard
 * pages. RLS-bound client: `vendor_admin_memberships_select_own` /
 * `restaurant_staff_select_own_or_scoped` already scope this correctly
 * (SRS §4).
 */
export async function getMyRestaurants(profile: AuthenticatedProfile): Promise<MyRestaurant[]> {
  const supabase = createServerSupabaseClient();
  const table = profile.role === "vendor_admin" ? "vendor_admin_memberships" : "restaurant_staff";

  const { data } = await supabase
    .from(table)
    .select("restaurant_id, restaurants(id, name)")
    .eq("user_id", profile.id)
    .is("disabled_at", null);

  return (data ?? [])
    .map((row: any) => row.restaurants)
    .filter((r: any): r is MyRestaurant => Boolean(r));
}
