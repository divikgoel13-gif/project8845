import type { Database } from "@/types/database";

export type OrderStatus = Database["public"]["Enums"]["order_status"];

/**
 * Status groupings shared by every admin and vendor aggregate.
 *
 * lib/data/vendor-analytics.ts defined `REALIZED_SALE_STATUSES` inline for the
 * vendor dashboard. Phase 7 adds a global dashboard, a live-operations command
 * center, a global orders list and (Phase 9) platform analytics — four more
 * places that must agree on which statuses count as a sale. Four copies of the
 * array is how a platform ends up with a dashboard whose GMV does not match its
 * own analytics page, and SRS §14 requires analytics to "reconcile with source
 * data".
 *
 * The groupings themselves are not arbitrary; each one answers one question:
 *
 *   REALIZED   Did money actually change hands for this order? Everything from
 *              'paid' onward, including 'collected'. Excludes cart and
 *              payment_pending (no payment captured) and every failure state.
 *
 *   IN_FLIGHT  Is this order still owed to a customer? Paid but not yet
 *              collected. This is the set live operations watches and the set
 *              whose value is genuine outstanding obligation.
 *
 *   FAILED     Did the order end without a collection? Cancelled, refunded,
 *              refund_pending and no_show. Reported separately rather than
 *              netted off GMV, because a cancelled order is a distinct
 *              operational event, not a smaller sale (SRS V2 §C).
 *
 * A deliberate consequence: a refunded order stays out of REALIZED, and the
 * refund itself is an additive ledger row in `refund_events`. Nothing here
 * rewrites the original sale, matching the snapshot rule in §11.5.
 */
export const REALIZED_SALE_STATUSES = [
  "paid",
  "scheduled",
  "preparing",
  "ready_for_pickup",
  "collected",
] as const satisfies readonly OrderStatus[];

export const IN_FLIGHT_STATUSES = [
  "paid",
  "scheduled",
  "preparing",
  "ready_for_pickup",
] as const satisfies readonly OrderStatus[];

export const FAILED_STATUSES = [
  "cancelled",
  "refund_pending",
  "refunded",
  "no_show",
] as const satisfies readonly OrderStatus[];

/** Statuses that have not yet produced a captured payment. */
export const PRE_PAYMENT_STATUSES = ["cart", "payment_pending"] as const satisfies readonly OrderStatus[];

export function isRealizedSale(status: string): boolean {
  return (REALIZED_SALE_STATUSES as readonly string[]).includes(status);
}

export function isInFlight(status: string): boolean {
  return (IN_FLIGHT_STATUSES as readonly string[]).includes(status);
}

export function isFailedOrder(status: string): boolean {
  return (FAILED_STATUSES as readonly string[]).includes(status);
}

/**
 * Customer-facing status wording, reused by the admin console so that an
 * operator on a support call reads the same words the customer is looking at.
 * Divergent vocabularies ("ready_for_pickup" vs "Ready") are a real source of
 * confusion on a phone call about one order.
 */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  cart: "In cart",
  payment_pending: "Payment pending",
  paid: "Paid",
  scheduled: "Scheduled",
  preparing: "Preparing",
  ready_for_pickup: "Ready for pickup",
  collected: "Collected",
  cancelled: "Cancelled",
  refund_pending: "Refund pending",
  refunded: "Refunded",
  no_show: "No show",
};

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status as OrderStatus] ?? status;
}

/** The filter options offered in the global and restaurant order lists. */
export const ORDER_STATUS_FILTERS: readonly OrderStatus[] = [
  "payment_pending",
  "paid",
  "scheduled",
  "preparing",
  "ready_for_pickup",
  "collected",
  "cancelled",
  "refund_pending",
  "refunded",
  "no_show",
];
