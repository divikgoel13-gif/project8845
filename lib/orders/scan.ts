import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { transitionOrder, OrderTransitionConflictError } from "@/lib/orders/state-machine";
import { recordAuditEvent } from "@/lib/audit/log";
import type { AuthenticatedProfile } from "@/lib/auth/roles";

const COLLECTIBLE_STATUSES = ["scheduled", "preparing", "ready_for_pickup"];

export type ScanOutcome =
  | { ok: true; restaurantName: string }
  | { ok: false; error: string };

/**
 * Resolves the unified group QR token to THIS restaurant's own order
 * within that group (SRS V2 §J: "When Restaurant A scans the QR, the
 * server resolves the group but returns only Restaurant A's own
 * order/items/pickup information... A restaurant cannot use the QR to
 * collect an order belonging to another restaurant."). Uses the
 * service-role client because resolving an arbitrary customer's QR token
 * is structurally impossible under RLS for a staff/vendor session scoped
 * to their own restaurant — this is exactly the kind of privileged read
 * lib/supabase/server.ts's service-role client exists for, and the
 * restaurant-scope check right below is what keeps it safe.
 */
async function resolveOrderForRestaurant(qrToken: string, restaurantId: string) {
  const supabase = createServiceRoleSupabaseClient();

  const { data: group } = await supabase
    .from("multi_order_groups")
    .select("id")
    .eq("qr_token", qrToken.trim())
    .maybeSingle();

  if (!group) return null;

  const { data: order } = await supabase
    .from("orders")
    .select("id, status, restaurant_id, restaurants(name)")
    .eq("group_id", group.id)
    .eq("restaurant_id", restaurantId) // the restaurant-scope check SRS V2 §J requires
    .maybeSingle();

  return order;
}

/**
 * Primary scan/collect flow. `qrToken` is whatever the staff device
 * produced — a camera-based decode, or manual entry (see
 * components/staff/scan-form.tsx's doc comment for why manual entry is
 * this build's actually-implemented input method). The caller MUST have
 * already verified restaurant scope via requireRestaurantScope() before
 * calling this — this function re-verifies again via the restaurant_id
 * filter above regardless (never trust a single check — SRS §17).
 */
export async function scanAndCollect(
  actor: AuthenticatedProfile,
  restaurantId: string,
  qrToken: string
): Promise<ScanOutcome> {
  const order = await resolveOrderForRestaurant(qrToken, restaurantId);

  if (!order) {
    await recordAuditEvent({
      actorId: actor.id,
      actorRole: actor.role,
      action: "order.scan_not_found",
      restaurantId,
      reason: "QR token did not resolve to an order for this restaurant",
    });
    return { ok: false, error: "This code isn't recognized for your restaurant." };
  }

  if (!COLLECTIBLE_STATUSES.includes(order.status)) {
    const message =
      order.status === "collected"
        ? "This order has already been collected."
        : order.status === "payment_pending" || order.status === "paid"
          ? "This order hasn't been confirmed for pickup yet."
          : `This order can't be collected (status: ${order.status}).`;
    return { ok: false, error: message };
  }

  try {
    await transitionOrder(order.id, order.status, "collected", { collected_at: new Date().toISOString() });
  } catch (e) {
    if (e instanceof OrderTransitionConflictError) {
      return { ok: false, error: "This order was just collected — possibly by another scan." };
    }
    throw e;
  }

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "order.collected",
    targetTable: "orders",
    targetId: order.id,
    restaurantId,
  });

  return { ok: true, restaurantName: (order as any).restaurants?.name ?? "Restaurant" };
}

export type CollectibleOrderForFallback = {
  orderId: string;
  customerName: string | null;
  customerPhone: string | null;
  status: string;
  pickupTime: string | null;
};

/**
 * QR fallback lookup (SRS V2 §K: "a controlled fallback for genuine QR
 * scanning failures... requires authenticated Staff/Vendor Admin identity
 * and restaurant scope"). Rather than a separate signed-token mechanism,
 * this build's fallback IS staff directly identifying the order by the
 * customer's phone number within their own restaurant's collectible
 * orders — see docs/PAYMENTS.md "QR fallback" for the full reasoning.
 * Search is intentionally narrow: only THIS restaurant's not-yet-collected
 * orders, never a general customer lookup.
 */
export async function findCollectibleOrdersByPhone(
  restaurantId: string,
  phoneQuery: string
): Promise<CollectibleOrderForFallback[]> {
  const supabase = createServiceRoleSupabaseClient();

  const { data } = await supabase
    .from("orders")
    .select("id, status, pickup_time, profiles!orders_customer_id_fkey(name, phone)")
    .eq("restaurant_id", restaurantId)
    .in("status", COLLECTIBLE_STATUSES)
    .order("pickup_time")
    .limit(50);

  const query = phoneQuery.replace(/\s+/g, "");
  return (data ?? [])
    .filter((o) => {
      const phone = (o as any).profiles?.phone as string | undefined;
      return phone && phone.replace(/\s+/g, "").includes(query);
    })
    .slice(0, 5)
    .map((o) => ({
      orderId: o.id,
      customerName: (o as any).profiles?.name ?? null,
      customerPhone: (o as any).profiles?.phone ?? null,
      status: o.status,
      pickupTime: o.pickup_time,
    }));
}

/**
 * Confirms collection via the fallback path — same underlying transition
 * and audit trail as a normal scan (SRS V2 §K: "cannot bypass payment
 * verification, order state, restaurant scope or collection checks"),
 * with a mandatory reason (V2 §K: "All fallback attempts are logged").
 */
export async function collectOrderWithFallback(
  actor: AuthenticatedProfile,
  restaurantId: string,
  orderId: string,
  reason: string
): Promise<ScanOutcome> {
  const supabase = createServiceRoleSupabaseClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, status, restaurant_id, restaurants(name)")
    .eq("id", orderId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  if (!order) {
    return { ok: false, error: "Order not found for your restaurant." };
  }
  if (!COLLECTIBLE_STATUSES.includes(order.status)) {
    return { ok: false, error: `This order can't be collected (status: ${order.status}).` };
  }

  try {
    await transitionOrder(order.id, order.status, "collected", { collected_at: new Date().toISOString() });
  } catch (e) {
    if (e instanceof OrderTransitionConflictError) {
      return { ok: false, error: "This order was just collected." };
    }
    throw e;
  }

  await recordAuditEvent({
    actorId: actor.id,
    actorRole: actor.role,
    action: "order.collected_via_fallback",
    targetTable: "orders",
    targetId: order.id,
    restaurantId,
    reason,
  });

  return { ok: true, restaurantName: (order as any).restaurants?.name ?? "Restaurant" };
}
