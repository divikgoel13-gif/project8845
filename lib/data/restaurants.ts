import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { acceptsNewOrders, type RestaurantLocationType, type RestaurantStatus } from "@/lib/restaurants/status";

export type RestaurantListItem = {
  id: string;
  name: string;
  slug: string;
  status: RestaurantStatus;
  description: string | null;
  location: string | null;
  logo_path: string | null;
  paused_until: string | null;
  /**
   * SRS V2.6 §29: carried into the listing so the discovery card can mark an
   * inside-university restaurant before the customer taps into it. The popup
   * itself is still shown on the restaurant page (§29.2 "when a customer
   * selects an Inside-University restaurant"), not here.
   */
  location_type: RestaurantLocationType;
  university_place_name: string | null;
};

/**
 * Active-restaurant listing for customer discovery (SRS §9 Discovery:
 * "Browse active restaurants... Search/filter restaurants/products...
 * View restaurant status, hours, pickup availability"). Uses the
 * request-scoped (RLS-subject) client deliberately — RLS's
 * `restaurants_select_active_public` policy already expresses exactly
 * this rule (non-archived, or super admin sees everything), so there's no
 * reason to bypass it here with the service-role client.
 */
export async function listDiscoverableRestaurants(searchTerm?: string): Promise<RestaurantListItem[]> {
  const supabase = createServerSupabaseClient();

  let query = supabase
    .from("restaurants")
    .select(
      `id, name, slug, status, description, location, logo_path, paused_until,
       location_type, university_place_name`
    )
    .neq("status", "archived")
    .order("name");

  if (searchTerm && searchTerm.trim().length > 0) {
    query = query.ilike("name", `%${searchTerm.trim()}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getRestaurantBySlug(slug: string) {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("restaurants")
    .select(
      `id, name, slug, status, description, location, logo_path, paused_until, paused_reason,
       closed_reason, location_type, university_place_name,
       preparation_default_minutes, pickup_slot_interval_minutes`
    )
    .eq("slug", slug)
    .neq("status", "archived")
    .single();

  if (error) return null;
  return data;
}

/**
 * Whether a restaurant is currently accepting new orders (SRS V2 §G, V2.6 §60).
 *
 * This is a UI-only summary for display purposes (badges, disabling the
 * "Add" button) — it deliberately duplicates part of the pause check in
 * lib/scheduling/feasibility.ts#checkPickupFeasibility, which is the
 * AUTHORITATIVE check every Server Action actually relies on before
 * writing anything. If these two ever diverge, feasibility.ts wins.
 *
 * Both now delegate to `acceptsNewOrders`, so the four V2.6 §60 states are
 * interpreted identically in the badge and in the write path. Before that they
 * were two separate expressions, and adding 'closed' to the enum would have
 * needed both to be found and edited.
 */
export function isRestaurantOrderable(restaurant: {
  status: RestaurantStatus;
  paused_until: string | null;
}): boolean {
  return acceptsNewOrders({
    status: restaurant.status,
    pausedUntil: restaurant.paused_until,
  });
}
