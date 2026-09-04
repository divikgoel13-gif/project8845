import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { resolveOpenWindow, isWithinWindow } from "@/lib/scheduling/hours";
import { remainingCapacity } from "@/lib/scheduling/capacity";
import { newOrderBlockReason } from "@/lib/restaurants/status";

export type FeasibilityResult =
  | { feasible: true }
  | { feasible: false; reason: FeasibilityFailureReason };

export type FeasibilityFailureReason =
  | "restaurant_not_found"
  | "restaurant_archived"
  | "restaurant_paused"
  /**
   * SRS V2.6 §60 'Closed': the restaurant is indefinitely not trading. Named
   * `restaurant_not_trading` rather than `restaurant_closed` because that reason
   * was already taken, below, by "outside today's opening hours" — a customer
   * told "closed" for a §60 Closed restaurant would reasonably try again
   * tomorrow.
   */
  | "restaurant_not_trading"
  | "restaurant_closed" // outside the day's open window (restaurant_hours)
  | "too_soon" // inside the preparation cutoff — not enough lead time
  | "slot_full";

/**
 * The single authoritative "can this restaurant accept an order for this
 * pickup time" check (SRS §2 Pickup-slot capacity / Preparation cutoff;
 * SRS V2 §G restaurant pause; SRS V2 §L checkout revalidation). Both the
 * scheduling UI (as a live availability hint) and Phase 3's checkout
 * revalidation MUST call this exact function — never re-implement these
 * rules client-side or duplicate them in a second server function that
 * could drift out of sync.
 *
 * `pickupTime` must already be an absolute UTC instant — this function
 * does not interpret ambiguous client input, that's the caller's job
 * (see lib/scheduling/timezone.ts buildCampusInstant for combining a
 * date-picker value with a chosen slot).
 */
export async function checkPickupFeasibility(
  restaurantId: string,
  pickupTime: Date
): Promise<FeasibilityResult> {
  const supabase = createServiceRoleSupabaseClient();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("status, archived_at, paused_until, preparation_default_minutes")
    .eq("id", restaurantId)
    .single();

  if (!restaurant) return { feasible: false, reason: "restaurant_not_found" };

  // SRS V2 §G / V2.6 §60: archived, paused and closed all block NEW orders and
  // none of them touches an existing one — this function is only ever consulted
  // for a new or re-timed pickup selection. The four-state interpretation lives
  // in lib/restaurants/status.ts so the customer badge and this authoritative
  // check cannot disagree about what 'closed' means.
  const blocked = newOrderBlockReason({
    status: restaurant.status,
    pausedUntil: restaurant.paused_until,
    archivedAt: restaurant.archived_at,
  });
  if (blocked) return { feasible: false, reason: blocked };

  const window = await resolveOpenWindow(restaurantId, pickupTime);
  if (!isWithinWindow(pickupTime, window)) {
    return { feasible: false, reason: "restaurant_closed" };
  }

  // Preparation cutoff (SRS §2): the pickup time must be far enough in the
  // future for the kitchen to realistically prepare the order.
  const minLeadMs = restaurant.preparation_default_minutes * 60_000;
  if (pickupTime.getTime() - Date.now() < minLeadMs) {
    return { feasible: false, reason: "too_soon" };
  }

  const remaining = await remainingCapacity(restaurantId, pickupTime);
  if (remaining <= 0) {
    return { feasible: false, reason: "slot_full" };
  }

  return { feasible: true };
}

export const FEASIBILITY_MESSAGES: Record<FeasibilityFailureReason, string> = {
  restaurant_not_found: "This restaurant could not be found.",
  restaurant_archived: "This restaurant is no longer available.",
  restaurant_paused: "This restaurant isn't accepting new orders right now.",
  restaurant_not_trading: "This restaurant is not currently trading on UNI8.",
  restaurant_closed: "This restaurant is closed at the selected pickup time.",
  too_soon: "That pickup time is too soon — please choose a later slot.",
  slot_full: "That pickup slot is full — please choose a different time.",
};
