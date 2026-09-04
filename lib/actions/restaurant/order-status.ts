"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRestaurantScope } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { transitionOrder, InvalidOrderTransitionError, OrderTransitionConflictError } from "@/lib/orders/state-machine";
import { recordAuditEvent } from "@/lib/audit/log";

/**
 * Operational order-status actions (SRS Phase 5 deliverable: "Operational
 * order statuses"). Lives under lib/actions/restaurant/ — not lib/actions/
 * vendor/ — because both Vendor Admin AND Staff need these (SRS §11:
 * Staff has "Orders + Scan permissions"), matching the convention already
 * established by lib/actions/restaurant/scan.ts. requireRestaurantScope's
 * default allowedRoles (["vendor_admin", "staff"]) is exactly the
 * boundary this needs, EXCEPT for cancellation, which carries a real
 * financial penalty (SRS V2 §C.2) and is deliberately restricted to
 * vendor_admin only — see cancelOrderByRestaurant below.
 *
 * Before this file, nothing in the codebase ever moved an order past
 * "scheduled" — finalizePayment() (Phase 3) auto-transitions
 * payment_pending → paid → scheduled, and scan.ts (Phase 3) handles
 * ready_for_pickup → collected, but preparing and ready_for_pickup were
 * unreachable in practice. This file is what makes the kitchen pipeline
 * actually operable.
 */

const OrderActionSchema = z.object({
  restaurantId: z.string().uuid(),
  orderId: z.string().uuid(),
});

async function loadOrderForRestaurant(orderId: string, restaurantId: string) {
  const supabase = createServiceRoleSupabaseClient();
  const { data: order } = await supabase
    .from("orders")
    .select("id, restaurant_id, status, pickup_time")
    .eq("id", orderId)
    .single();

  if (!order || order.restaurant_id !== restaurantId) {
    throw new Error("Order not found for this restaurant.");
  }
  return order;
}

function friendlyTransitionError(e: unknown): string {
  if (e instanceof OrderTransitionConflictError) {
    return "This order was already updated — refresh to see its current status.";
  }
  if (e instanceof InvalidOrderTransitionError) {
    return "This order can't move to that status from where it currently is.";
  }
  return e instanceof Error ? e.message : "Could not update this order.";
}

export async function startPreparing(input: { restaurantId: string; orderId: string }) {
  const profile = await requireRestaurantScope(input.restaurantId);
  const parsed = OrderActionSchema.parse(input);
  const order = await loadOrderForRestaurant(parsed.orderId, parsed.restaurantId);

  try {
    await transitionOrder(order.id, "scheduled", "preparing");
  } catch (e) {
    throw new Error(friendlyTransitionError(e));
  }

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: profile.role,
    action: "order.preparing_started",
    targetTable: "orders",
    targetId: order.id,
    restaurantId: parsed.restaurantId,
    before: { status: "scheduled" },
    after: { status: "preparing" },
  });

  revalidatePath("/vendor/orders");
  revalidatePath("/staff/orders");
}

export async function markReady(input: { restaurantId: string; orderId: string }) {
  const profile = await requireRestaurantScope(input.restaurantId);
  const parsed = OrderActionSchema.parse(input);
  const order = await loadOrderForRestaurant(parsed.orderId, parsed.restaurantId);

  try {
    // ready_source: 'manual' — SRS V2 §B.2 distinguishes this from the
    // 'auto' grace-period transition described in admin_settings'
    // auto_ready_grace_minutes. No scheduler exists in this environment
    // to actually run that auto-transition (see markNoShow below for the
    // same limitation, documented rather than silently unimplemented) —
    // this manual action is the one currently-working path to
    // ready_for_pickup.
    await transitionOrder(order.id, "preparing", "ready_for_pickup", {
      ready_at: new Date().toISOString(),
      ready_source: "manual",
    });
  } catch (e) {
    throw new Error(friendlyTransitionError(e));
  }

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: profile.role,
    action: "order.marked_ready",
    targetTable: "orders",
    targetId: order.id,
    restaurantId: parsed.restaurantId,
    before: { status: "preparing" },
    after: { status: "ready_for_pickup" },
  });

  revalidatePath("/vendor/orders");
  revalidatePath("/staff/orders");
}

/**
 * Grace period/no-show handling (SRS Phase 5 deliverable). Worth being
 * explicit about a real limitation: this is a MANUAL action, triggered
 * by a staff/vendor admin marking an overdue order as no-show — there is
 * no scheduler/cron in this Next.js deployment to do this automatically
 * once a grace period elapses. The dashboard/orders "overdue" alert
 * (lib/data/vendor-analytics.ts, and the equivalent surfaced on this
 * page) is what makes an overdue order visible enough to act on manually
 * in the meantime. A real cron-triggered auto no-show (matching
 * admin_settings.default_grace_period_minutes) is a natural fast-follow
 * once this deploys somewhere with a scheduler (e.g. a Supabase Edge
 * Function on a cron trigger) — not fabricated here since it wouldn't
 * actually run in this environment.
 */
export async function markNoShow(input: { restaurantId: string; orderId: string }) {
  const profile = await requireRestaurantScope(input.restaurantId);
  const parsed = OrderActionSchema.parse(input);
  const order = await loadOrderForRestaurant(parsed.orderId, parsed.restaurantId);

  const fromStatus = order.status === "ready_for_pickup" || order.status === "scheduled" ? order.status : null;
  if (!fromStatus) {
    throw new Error("This order isn't in a state that can be marked no-show.");
  }

  try {
    await transitionOrder(order.id, fromStatus, "no_show", { no_show_at: new Date().toISOString() });
  } catch (e) {
    throw new Error(friendlyTransitionError(e));
  }

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: profile.role,
    action: "order.marked_no_show",
    targetTable: "orders",
    targetId: order.id,
    restaurantId: parsed.restaurantId,
    before: { status: fromStatus },
    after: { status: "no_show" },
  });

  revalidatePath("/vendor/orders");
  revalidatePath("/staff/orders");
}

const CancelOrderSchema = OrderActionSchema.extend({
  reason: z.string().trim().min(1, "A cancellation reason is required.").max(500),
});

/**
 * Restaurant-initiated cancellation with penalty (SRS V2 §C.2: "must not
 * overwrite the original sale" — hence the separate
 * restaurant_cancellation_events ledger row, distinct from the order's
 * own commission_rate_snapshot/commission_amount_paise). Vendor-Admin-
 * only — unlike the other actions in this file, this carries a real,
 * automatic financial consequence for the restaurant, which is a bigger
 * decision than a staff member marking a pickup as ready or no-show.
 */
export async function cancelOrderByRestaurant(input: { restaurantId: string; orderId: string; reason: string }) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = CancelOrderSchema.parse(input);
  const order = await loadOrderForRestaurant(parsed.orderId, parsed.restaurantId);

  if (order.status !== "scheduled" && order.status !== "preparing") {
    throw new Error("This order can no longer be cancelled by the restaurant.");
  }

  const supabase = createServiceRoleSupabaseClient();

  const { data: penaltySetting } = await supabase
    .from("admin_settings")
    .select("value")
    .eq("key", "restaurant_cancellation_penalty_rate")
    .single();

  // No hardcoded fallback here either — same reasoning as the commission
  // rate fix in lib/actions/customer/checkout.ts (see
  // docs/PHASE_GATE_ACCEPTANCE_RECORD_1.md): fail loudly rather than
  // silently compute a real financial penalty against a magic number.
  if (typeof penaltySetting?.value !== "number") {
    throw new Error("Cancellation is temporarily unavailable. Please try again shortly.");
  }
  const penaltyRate = penaltySetting.value;

  const { data: fullOrder } = await supabase
    .from("orders")
    .select("subtotal_paise")
    .eq("id", order.id)
    .single();

  if (!fullOrder) throw new Error("Order not found.");

  const penaltyAmountPaise = Math.round(fullOrder.subtotal_paise * penaltyRate);

  try {
    await transitionOrder(order.id, order.status, "cancelled", {
      cancelled_at: new Date().toISOString(),
      cancelled_by: profile.id,
      cancel_reason: parsed.reason,
      cancel_penalty_rate: penaltyRate,
      cancel_penalty_amount_paise: penaltyAmountPaise,
    });
  } catch (e) {
    throw new Error(friendlyTransitionError(e));
  }

  await supabase.from("restaurant_cancellation_events").insert({
    order_id: order.id,
    restaurant_id: parsed.restaurantId,
    actor_id: profile.id,
    reason: parsed.reason,
    penalty_rate: penaltyRate,
    penalty_amount_paise: penaltyAmountPaise,
  });

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "order.cancelled_by_restaurant",
    targetTable: "orders",
    targetId: order.id,
    restaurantId: parsed.restaurantId,
    before: { status: order.status },
    after: { status: "cancelled", penaltyAmountPaise },
    reason: parsed.reason,
  });

  revalidatePath("/vendor/orders");
  revalidatePath("/staff/orders");
}
