import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { fetchRazorpayPayment, capturePayment } from "@/lib/payments/razorpay";
import { transitionOrder } from "@/lib/orders/state-machine";
import { checkPickupFeasibility, FEASIBILITY_MESSAGES } from "@/lib/scheduling/feasibility";
import { recordAuditEvent } from "@/lib/audit/log";
import { sendNotification } from "@/lib/notifications/send";
import type { Json } from "@/types/database";

export type FinalizeResult =
  | { ok: true; alreadyProcessed: boolean; orderIds: string[] }
  | { ok: false; reason: string };

/**
 * The ONE function that turns a Razorpay payment into confirmed UNI8
 * orders. Called from two entry points — the Razorpay webhook (primary,
 * authoritative — SRS §12) and a client-triggered "verify" Server Action
 * right after Checkout's success handler returns (pure UX accelerant, so
 * the customer doesn't wait for a webhook round-trip). BOTH entry points
 * funnel through this exact function rather than each having their own
 * order-creation logic, and this function independently re-fetches the
 * payment from Razorpay's API rather than trusting whichever caller's
 * payload — the webhook body's signature proves Razorpay sent it, and the
 * checkout callback's signature proves it round-tripped correctly, but
 * neither is treated as canonical truth about payment STATE; only a fresh
 * GET /v1/payments/:id is (SRS §17: server/database is authoritative).
 *
 * IDEMPOTENCY, three layers deep:
 *   1. `providerEventId` is checked against `payment_events` — a redelivered
 *      webhook (Razorpay retries on non-2xx) or an accidental double-call
 *      short-circuits here.
 *   2. The `payments` row UPDATE uses `.neq("status", "captured")` — if a
 *      racing call already flipped it to captured, this UPDATE affects
 *      zero rows and we treat that as "already processed," not an error.
 *   3. Each order's payment_pending → paid transition goes through
 *      `transitionOrder`, which has its own optimistic-concurrency guard.
 *
 * PAYMENT/ORDER EXCEPTION HANDLING (SRS Phase 3 deliverable): if a pickup
 * slot became infeasible (full, restaurant paused, hours changed) between
 * checkout initiation and payment confirmation, the order is still
 * honored — the customer's money was captured, and V1 has no automated
 * refund path (SRS V2 §C.3: refunds are always manual, via a grievance).
 * That case is logged as an audit exception for Super Admin to see and
 * handle manually, not silently swallowed and not used to block the order.
 */
/** rawPayload is `unknown` provider data; round-tripping through JSON both
 *  satisfies the payment_events.payload jsonb column's Json type and
 *  guarantees at runtime that what we store is what Postgres can actually
 *  hold. */
function toJsonPayload(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

export async function finalizePayment(params: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  providerEventId: string;
  eventType: string;
  rawPayload: unknown;
}): Promise<FinalizeResult> {
  const supabase = createServiceRoleSupabaseClient();

  // Idempotency layer 1: has this exact provider event already been processed?
  const { data: existingEvent } = await supabase
    .from("payment_events")
    .select("id")
    .eq("provider_event_id", params.providerEventId)
    .maybeSingle();

  if (existingEvent) {
    const orderIds = await getOrderIdsForRazorpayOrder(params.razorpayOrderId);
    return { ok: true, alreadyProcessed: true, orderIds };
  }

  const { data: payment } = await supabase
    .from("payments")
    .select("id, group_id, customer_id, amount_paise, status")
    .eq("razorpay_order_id", params.razorpayOrderId)
    .single();

  if (!payment) {
    await recordAuditEvent({
      actorId: null,
      actorRole: null,
      action: "payment.finalize_no_matching_payment_row",
      reason: `razorpay_order_id=${params.razorpayOrderId} payment_id=${params.razorpayPaymentId}`,
    });
    return { ok: false, reason: "No matching payment record found." };
  }

  if (payment.status === "captured") {
    const orderIds = await getOrderIdsForRazorpayOrder(params.razorpayOrderId);
    return { ok: true, alreadyProcessed: true, orderIds };
  }

  // Fetch canonical payment state from Razorpay — never trust the
  // webhook payload or client callback data alone for anything beyond
  // "should I bother checking."
  let rpPayment;
  try {
    rpPayment = await fetchRazorpayPayment(params.razorpayPaymentId);
  } catch (e) {
    await recordAuditEvent({
      actorId: payment.customer_id,
      actorRole: "customer",
      action: "payment.finalize_fetch_failed",
      targetTable: "payments",
      targetId: payment.id,
      reason: e instanceof Error ? e.message : "Unknown error",
    });
    return { ok: false, reason: "Could not verify payment with Razorpay." };
  }

  if (rpPayment.order_id !== params.razorpayOrderId) {
    await recordAuditEvent({
      actorId: payment.customer_id,
      actorRole: "customer",
      action: "payment.finalize_order_id_mismatch",
      targetTable: "payments",
      targetId: payment.id,
      reason: `expected order_id=${params.razorpayOrderId}, got ${rpPayment.order_id}`,
    });
    return { ok: false, reason: "Payment/order mismatch." };
  }

  if (rpPayment.amount !== payment.amount_paise) {
    await recordAuditEvent({
      actorId: payment.customer_id,
      actorRole: "customer",
      action: "payment.finalize_amount_mismatch",
      targetTable: "payments",
      targetId: payment.id,
      reason: `expected ${payment.amount_paise} paise, Razorpay reports ${rpPayment.amount} paise`,
    });
    return { ok: false, reason: "Payment amount mismatch." };
  }

  // Defensive capture — should already be captured given
  // `capture: "automatic"` at order-creation time, but an uncaptured
  // authorization is money not actually collected, silently, days later.
  if (rpPayment.status === "authorized") {
    try {
      rpPayment = await capturePayment(params.razorpayPaymentId, payment.amount_paise);
    } catch (e) {
      await recordAuditEvent({
        actorId: payment.customer_id,
        actorRole: "customer",
        action: "payment.finalize_capture_failed",
        targetTable: "payments",
        targetId: payment.id,
        reason: e instanceof Error ? e.message : "Unknown error",
      });
      return { ok: false, reason: "Could not capture payment." };
    }
  }

  if (rpPayment.status !== "captured") {
    // Genuinely failed/pending payment — record the event for audit
    // trail but don't create/transition orders.
    await supabase.from("payment_events").insert({
      payment_id: payment.id,
      provider_event_id: params.providerEventId,
      event_type: params.eventType,
      payload: toJsonPayload(params.rawPayload),
    });
    return { ok: false, reason: `Payment status is "${rpPayment.status}", not captured.` };
  }

  // Idempotency layer 2: conditional UPDATE — only proceeds if we're the
  // first caller to observe this payment as captured.
  const { data: updatedPayment } = await supabase
    .from("payments")
    .update({ status: "captured", razorpay_payment_id: params.razorpayPaymentId })
    .eq("id", payment.id)
    .neq("status", "captured")
    .select("id");

  if (!updatedPayment || updatedPayment.length === 0) {
    // A racing call already finalized this — treat as success, not error.
    const orderIds = await getOrderIdsForRazorpayOrder(params.razorpayOrderId);
    return { ok: true, alreadyProcessed: true, orderIds };
  }

  await supabase.from("payment_events").insert({
    payment_id: payment.id,
    provider_event_id: params.providerEventId,
    event_type: params.eventType,
    payload: toJsonPayload(params.rawPayload),
  });

  const { data: pendingOrders } = await supabase
    .from("orders")
    .select("id, restaurant_id, pickup_time, vendor_payable_paise")
    .eq("group_id", payment.group_id)
    .eq("status", "payment_pending");

  const orderIds: string[] = [];

  for (const order of pendingOrders ?? []) {
    // Last-chance feasibility check — see this function's own doc comment
    // on exception handling. We NEVER skip creating the order over this;
    // we only log it.
    if (order.pickup_time) {
      const feasibility = await checkPickupFeasibility(order.restaurant_id, new Date(order.pickup_time));
      if (!feasibility.feasible) {
        await recordAuditEvent({
          actorId: payment.customer_id,
          actorRole: "customer",
          action: "order.paid_despite_infeasible_slot",
          targetTable: "orders",
          targetId: order.id,
          restaurantId: order.restaurant_id,
          reason: FEASIBILITY_MESSAGES[feasibility.reason],
        });
      }
    }

    try {
      await transitionOrder(order.id, "payment_pending", "paid");
      await transitionOrder(order.id, "paid", "scheduled");
    } catch (e) {
      // An individual order failing to transition must not abort the
      // whole batch — the customer paid for ALL of it. Log loudly and
      // continue; Super Admin's exception queue (Phase 7) is where this
      // gets resolved in production.
      await recordAuditEvent({
        actorId: payment.customer_id,
        actorRole: "customer",
        action: "order.post_payment_transition_failed",
        targetTable: "orders",
        targetId: order.id,
        restaurantId: order.restaurant_id,
        reason: e instanceof Error ? e.message : "Unknown error",
      });
      continue;
    }

    if (order.vendor_payable_paise !== null) {
      await supabase.from("vendor_payables").insert({
        order_id: order.id,
        restaurant_id: order.restaurant_id,
        amount_paise: order.vendor_payable_paise,
      });
    }

    orderIds.push(order.id);
  }

  // Clear the customer's cart — everything in it was just purchased (see
  // lib/actions/customer/schedule.ts's validation that every orderable
  // cart group must be part of the scheduled sequence).
  const { data: cart } = await supabase
    .from("carts")
    .select("id")
    .eq("customer_id", payment.customer_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cart) {
    await supabase.from("cart_items").delete().eq("cart_id", cart.id);
  }

  await recordAuditEvent({
    actorId: payment.customer_id,
    actorRole: "customer",
    action: "payment.captured_and_orders_confirmed",
    targetTable: "payments",
    targetId: payment.id,
    after: { orderIds, amountPaise: payment.amount_paise },
  });

  // SRS V2 §E.2: "Order placed/payment confirmed" is a V1 SMS event.
  // Best-effort — a notification failure must never unwind a successful
  // payment/order confirmation.
  try {
    await sendNotification(
      payment.customer_id,
      "order_paid",
      { orderIds, amountPaise: payment.amount_paise },
      `order_paid:${payment.id}`
    );
  } catch {
    // swallowed deliberately — see lib/notifications/send.ts
  }

  return { ok: true, alreadyProcessed: false, orderIds };
}

async function getOrderIdsForRazorpayOrder(razorpayOrderId: string): Promise<string[]> {
  const supabase = createServiceRoleSupabaseClient();
  const { data: payment } = await supabase
    .from("payments")
    .select("group_id")
    .eq("razorpay_order_id", razorpayOrderId)
    .single();

  if (!payment) return [];

  const { data: orders } = await supabase.from("orders").select("id").eq("group_id", payment.group_id);
  return (orders ?? []).map((o) => o.id);
}
