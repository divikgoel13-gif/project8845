import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type OrderStatus = Database["public"]["Enums"]["order_status"];

/**
 * The order state machine (SRS §14). This TypeScript table is mirrored by
 * a Postgres trigger (`enforce_order_status_transition` in
 * supabase/migrations/0011_order_state_machine_trigger.sql) as an
 * independent defense-in-depth layer — the same "three layers don't trust
 * each other" philosophy as authorization (see docs/ARCHITECTURE.md).
 * If you change this table, change the SQL trigger to match, and vice
 * versa — a comment in each file points back to the other.
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  // "cart" is a cart-line status, not a reachable order-state-machine node —
  // an order row is only ever created once it leaves the cart — so it has no
  // outgoing transitions here.
  cart: [],
  payment_pending: ["paid", "cancelled"], // cancelled here = payment failed/abandoned, not a restaurant cancellation
  paid: ["scheduled"],
  scheduled: ["preparing", "cancelled", "no_show"],
  preparing: ["ready_for_pickup", "cancelled"],
  ready_for_pickup: ["collected", "no_show", "cancelled"],
  collected: [],
  cancelled: ["refund_pending"],
  refund_pending: ["refunded"],
  refunded: [],
  no_show: [],
};

export class OrderTransitionConflictError extends Error {
  constructor(orderId: string, expectedStatus: string) {
    super(`Order ${orderId} was not in status "${expectedStatus}" — it may have already been updated by another action.`);
    this.name = "OrderTransitionConflictError";
  }
}

export class InvalidOrderTransitionError extends Error {
  constructor(fromStatus: string, toStatus: string) {
    super(`"${fromStatus}" → "${toStatus}" is not a valid order state transition.`);
    this.name = "InvalidOrderTransitionError";
  }
}

/**
 * Performs a single order status transition with OPTIMISTIC CONCURRENCY:
 * the UPDATE's WHERE clause requires the row to still be in
 * `fromStatus` at write time. If two requests race (e.g. two near-
 * simultaneous QR scans, or a webhook and a client-verify call both
 * finalizing the same payment), only one UPDATE actually matches a row —
 * the loser gets zero rows back and this throws
 * OrderTransitionConflictError, which callers turn into a friendly
 * message ("already collected", "already processed") rather than a
 * silent double-transition (SRS §14: "Only valid server-side transitions
 * are permitted"; SRS Phase 3 completion standard: "Double scanning
 * cannot double-collect").
 *
 * `extra` fields are set in the same UPDATE (e.g. { collected_at, ready_source }).
 */
export async function transitionOrder(
  orderId: string,
  fromStatus: OrderStatus,
  toStatus: OrderStatus,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const allowed = ORDER_STATUS_TRANSITIONS[fromStatus];
  if (!allowed.includes(toStatus)) {
    throw new InvalidOrderTransitionError(fromStatus, toStatus);
  }

  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase
    .from("orders")
    .update({ status: toStatus, ...extra })
    .eq("id", orderId)
    .eq("status", fromStatus)
    .select("id");

  if (error) {
    throw new Error(`Failed to transition order ${orderId}: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new OrderTransitionConflictError(orderId, fromStatus);
  }
}
