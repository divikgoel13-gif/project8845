import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";

/**
 * Resolves the walking time (minutes) between two restaurants from the
 * backend-configured matrix (SRS §2 Walking-time matrix). Falls back to
 * the reverse-direction row if only one direction was configured — see
 * the comment on the walking_times table in
 * supabase/migrations/0002_core_tables.sql. Returns null if no walking
 * time is configured in either direction, so the caller can surface a
 * clear error instead of silently guessing 0.
 */
export async function getWalkingTimeMinutes(
  fromRestaurantId: string,
  toRestaurantId: string
): Promise<number | null> {
  const supabase = createServiceRoleSupabaseClient();

  const { data: forward } = await supabase
    .from("walking_times")
    .select("minutes")
    .eq("restaurant_from_id", fromRestaurantId)
    .eq("restaurant_to_id", toRestaurantId)
    .maybeSingle();

  if (forward) return forward.minutes;

  const { data: reverse } = await supabase
    .from("walking_times")
    .select("minutes")
    .eq("restaurant_from_id", toRestaurantId)
    .eq("restaurant_to_id", fromRestaurantId)
    .maybeSingle();

  return reverse?.minutes ?? null;
}

/**
 * Computes the absolute pickup time for "immediately after previous
 * pickup" mode (SRS §9: "Each subsequent restaurant gets a specific time
 * OR 'immediately after previous pickup'. Immediate-after uses backend
 * walking time.").
 *
 * next_pickup_time = previous_restaurant_pickup_time + walking_time_minutes
 *
 * This is deliberately NOT rounded to the destination restaurant's slot
 * boundary — rounding up "for tidiness" would silently push the customer's
 * actual pickup later than the walk requires. The exact computed instant
 * is what gets feasibility-checked (capacity/hours/cutoff) by the caller
 * via checkPickupFeasibility — if that exact minute is infeasible, the
 * customer is told so and must choose a fixed time instead of the app
 * quietly moving it.
 */
export async function resolveImmediateAfterTime(
  previousRestaurantId: string,
  previousPickupTime: Date,
  nextRestaurantId: string
): Promise<{ pickupTime: Date; walkingMinutes: number } | { error: "no_walking_time_configured" }> {
  const walkingMinutes = await getWalkingTimeMinutes(previousRestaurantId, nextRestaurantId);

  if (walkingMinutes === null) {
    return { error: "no_walking_time_configured" };
  }

  const pickupTime = new Date(previousPickupTime.getTime() + walkingMinutes * 60_000);
  return { pickupTime, walkingMinutes };
}
