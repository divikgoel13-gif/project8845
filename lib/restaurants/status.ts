/**
 * Restaurant lifecycle state (SRS V2.6 §60).
 *
 * §60 states the four states explicitly: "Restaurant states are explicitly
 * Open, Paused, Closed and Archived." Before V2.6 the enum had three, and three
 * separate modules each declared their own `"active" | "paused" | "archived"`
 * union — the customer discovery reader, the vendor settings reader and the
 * admin workspace context. Adding a fourth label to the enum would have left
 * any one of them silently narrower than the database, which is the failure mode
 * where a Closed restaurant renders as "Active" because the switch fell through
 * to a default.
 *
 * So the union lives here once, derived from the generated enum rather than
 * retyped, and everything that needs it imports from here. There is no
 * `server-only` marker: this is pure logic over plain values, and the customer
 * restaurant page needs `restaurantOperationalState` on the client to render the
 * §H countdown alongside the state.
 *
 * The four states and what each means operationally:
 *
 *   active    -- §60 "Open". Trading. The only state that accepts new orders.
 *   paused    -- §G. A short operational breather. May be timed (`paused_until`)
 *                or indefinite. Blocks new orders; existing paid orders are
 *                untouched and must still be collectable.
 *   closed    -- §60. Indefinitely not trading, but NOT an archive: the
 *                restaurant still exists, still owes/holds payouts, still has
 *                readable history, and can be reopened without being recreated.
 *   archived  -- Removed from the platform. Never hard-deleted (§P), so the
 *                Super Admin workspace stays readable.
 */

import type { Database } from "@/types/database";

export type RestaurantStatus = Database["public"]["Enums"]["restaurant_status"];

export type RestaurantLocationType =
  Database["public"]["Enums"]["restaurant_location_type"];

/**
 * What a header should SHOW, which is not the same as the stored status.
 *
 * A restaurant paused with `paused_until` in the past is still stored as
 * 'paused' — nothing sweeps the column, deliberately, because a background job
 * that rewrote status would erase the reason it was paused. Reporting "Paused"
 * there would send an operator chasing a problem that has already expired, so
 * an elapsed timed pause resolves to 'active'.
 *
 * 'closed' has no derived variant: it never expires on its own.
 */
export type RestaurantOperationalState =
  | "active"
  | "paused"
  | "paused-until"
  | "closed"
  | "archived";

export function restaurantOperationalState(
  r: { status: RestaurantStatus; pausedUntil: string | null },
  now: Date = new Date()
): RestaurantOperationalState {
  if (r.status === "archived") return "archived";
  if (r.status === "closed") return "closed";
  if (r.status === "paused") {
    if (!r.pausedUntil) return "paused";
    return new Date(r.pausedUntil) > now ? "paused-until" : "active";
  }
  // An 'active' row can still carry a future paused_until if a vendor scheduled
  // a pause without changing status; §G treats that as paused.
  if (r.pausedUntil && new Date(r.pausedUntil) > now) return "paused-until";
  return "active";
}

export function restaurantStateLabel(state: RestaurantOperationalState): string {
  switch (state) {
    case "archived":
      return "Archived";
    case "closed":
      return "Closed";
    case "paused":
      return "Paused indefinitely";
    case "paused-until":
      return "Paused (timed)";
    default:
      return "Active";
  }
}

/**
 * The single question every new-order path actually asks. Written as one
 * function rather than repeated `status === 'paused' || status === 'closed'`
 * comparisons, because that is exactly the expression that was missed when
 * 'closed' was added to the enum.
 *
 * §G / §60: none of these states affect an EXISTING paid order. Collection, QR
 * scanning, refunds and payouts must keep working for orders already placed, so
 * this predicate is only ever consulted when creating or re-timing an order.
 */
export function acceptsNewOrders(
  r: { status: RestaurantStatus; pausedUntil: string | null; archivedAt?: string | null },
  now: Date = new Date()
): boolean {
  if (r.archivedAt) return false;
  return restaurantOperationalState(r, now) === "active";
}

/**
 * Why a restaurant is not accepting orders, in the vocabulary
 * `checkPickupFeasibility` already returns to callers.
 */
export function newOrderBlockReason(
  r: { status: RestaurantStatus; pausedUntil: string | null; archivedAt?: string | null },
  now: Date = new Date()
): "restaurant_archived" | "restaurant_not_trading" | "restaurant_paused" | null {
  if (r.archivedAt) return "restaurant_archived";
  const state = restaurantOperationalState(r, now);
  switch (state) {
    case "archived":
      return "restaurant_archived";
    case "closed":
      return "restaurant_not_trading";
    case "paused":
    case "paused-until":
      return "restaurant_paused";
    default:
      return null;
  }
}

/**
 * §29.2 popup copy. Kept next to the state helpers because both are read by the
 * same customer restaurant page, and kept as a function over the DB value
 * because §29.1 requires the place name to be database-backed and "must never
 * be hardcoded in the frontend".
 *
 * The sentence is §29.2's "required message concept" transcribed, with only the
 * place name interpolated. It is deliberately not reworded: §29.3 makes clear
 * the popup is the platform's entire statement of the physical access
 * restriction, so softening or embellishing it changes what UNI8 has told the
 * customer.
 *
 * Returns null when there is nothing to warn about, so a caller cannot
 * accidentally render an empty warning: an outside-university restaurant, or an
 * inside-university row whose place name is somehow missing, produces no popup
 * rather than a sentence with a hole in it. The database check constraint makes
 * the second case unreachable for new writes.
 */
export function universityAccessWarning(r: {
  locationType: RestaurantLocationType;
  universityPlaceName: string | null;
}): string | null {
  if (r.locationType !== "inside_university") return null;
  const place = r.universityPlaceName?.trim();
  if (!place) return null;
  return (
    `You can only order from ${place} if you are a valid student/faculty/staff ` +
    `member who can enter the university.`
  );
}

/**
 * §29.2: "OK displays a five-second countdown in brackets: OK (5), OK (4), etc.,
 * ending as OK when the countdown reaches zero."
 *
 * A constant rather than a literal in the component, because the same number
 * governs the countdown timer, the disabled state of the button and the label,
 * and three copies of `5` is three chances for them to disagree.
 */
export const UNIVERSITY_POPUP_COUNTDOWN_SECONDS = 5;

export function universityPopupOkLabel(secondsRemaining: number): string {
  return secondsRemaining > 0 ? `OK (${secondsRemaining})` : "OK";
}
