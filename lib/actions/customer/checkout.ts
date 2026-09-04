"use server";

import { requireRole } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getCheckoutPreview } from "@/lib/actions/customer/checkout-preview";
import { createRazorpayOrder } from "@/lib/payments/razorpay";
import { recordAuditEvent } from "@/lib/audit/log";

export type InitiateCheckoutResult =
  | {
      ok: true;
      razorpayOrderId: string;
      amountPaise: number;
      keyId: string;
      customerName: string | null;
      customerEmail: string | null;
      customerPhone: string | null;
    }
  | { ok: false; issues: string[] };

/**
 * Creates the Razorpay Order and the underlying UNI8 `orders` rows
 * (status `payment_pending`) for a validated checkout group (SRS §9
 * Payment: "Server-authoritative price/total"; §14: `payment_pending` =
 * "Razorpay order exists; payment not verified").
 *
 * Orders are created HERE, before payment — matching the SRS §14 state
 * machine's explicit `payment_pending` state — with `order_items`
 * snapshotting name/price at this exact moment (SRS: "immutable
 * purchased-item snapshots"). Capacity accounting excludes
 * `payment_pending` orders (see lib/scheduling/capacity.ts), so an
 * abandoned checkout doesn't permanently block a pickup slot nobody paid
 * for.
 *
 * IDEMPOTENT ON RETRY: if this group already has `payment_pending` orders
 * from an earlier call (double-click, page reload, browser back-forward),
 * this returns the SAME Razorpay order rather than creating duplicates —
 * satisfying the Phase 3 completion standard "Failed/duplicate payment
 * events do not create duplicate orders" one step earlier, at checkout
 * initiation rather than only at webhook processing.
 */
export async function initiateRazorpayCheckout(groupId: string): Promise<InitiateCheckoutResult> {
  const profile = await requireRole("customer");
  const supabase = createServiceRoleSupabaseClient();

  const { data: group } = await supabase
    .from("multi_order_groups")
    .select("id, customer_id")
    .eq("id", groupId)
    .single();

  if (!group || group.customer_id !== profile.id) {
    return { ok: false, issues: ["This checkout session could not be found."] };
  }

  // Idempotent reuse: an existing payment_pending attempt for this group
  // with a not-yet-captured payments row means "retry the same payment,"
  // not "create everything again."
  const { data: existingOrders } = await supabase
    .from("orders")
    .select("id, group_id")
    .eq("group_id", groupId)
    .eq("status", "payment_pending")
    .limit(1);

  if (existingOrders && existingOrders.length > 0) {
    const { data: existingPayment } = await supabase
      .from("payments")
      .select("razorpay_order_id, amount_paise, status")
      .eq("group_id", groupId)
      .neq("status", "captured")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingPayment?.razorpay_order_id) {
      return {
        ok: true,
        razorpayOrderId: existingPayment.razorpay_order_id,
        amountPaise: existingPayment.amount_paise,
        keyId: process.env.RAZORPAY_KEY_ID!,
        customerName: profile.name,
        customerEmail: profile.email,
        customerPhone: profile.phone,
      };
    }
  }

  // Fresh attempt — re-validate everything one more time, immediately
  // before writing financial records (SRS V2 §L stale-cart protection).
  const preview = await getCheckoutPreview(groupId);
  if (!preview.valid) {
    return { ok: false, issues: preview.issues };
  }

  const { data: commissionSetting, error: commissionError } = await supabase
    .from("admin_settings")
    .select("value")
    .eq("key", "commission_rate")
    .single();

  // No hardcoded fallback here, on purpose (see docs/HANDOVER_1.md — "the
  // commission rate is never hardcoded, anywhere", SRS §23). If the setting
  // is missing or malformed, fail the checkout loudly rather than silently
  // computing every order's commission split against a magic number that
  // could silently diverge from admin_settings.commission_rate.
  if (commissionError || typeof commissionSetting?.value !== "number") {
    return {
      ok: false,
      issues: ["Checkout is temporarily unavailable. Please try again shortly."],
    };
  }

  const commissionRate = commissionSetting.value;

  const createdOrderIds: string[] = [];

  for (const restaurant of preview.restaurants) {
    const commissionAmountPaise = Math.round(restaurant.subtotalPaise * commissionRate);
    const vendorPayablePaise = restaurant.subtotalPaise - commissionAmountPaise;

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        group_id: groupId,
        customer_id: profile.id,
        restaurant_id: restaurant.restaurantId,
        status: "payment_pending",
        subtotal_paise: restaurant.subtotalPaise,
        // Commission is snapshotted NOW — never recalculated from a later
        // admin_settings value (SRS §11.5, §23).
        commission_rate_snapshot: commissionRate,
        commission_amount_paise: commissionAmountPaise,
        vendor_payable_paise: vendorPayablePaise,
        pickup_time: restaurant.pickupTime,
      })
      .select("id")
      .single();

    if (orderError || !order) {
      return { ok: false, issues: ["Could not create your order. Please try again."] };
    }

    createdOrderIds.push(order.id);

    const { error: itemsError } = await supabase.from("order_items").insert(
      restaurant.items.map((item) => ({
        order_id: order.id,
        name_snapshot: item.name,
        price_snapshot_paise: item.pricePaise,
        quantity: item.quantity,
      }))
    );

    if (itemsError) {
      return { ok: false, issues: ["Could not save your order items. Please try again."] };
    }
  }

  let razorpayOrder;
  try {
    razorpayOrder = await createRazorpayOrder(preview.grandTotalPaise, groupId, {
      group_id: groupId,
      customer_id: profile.id,
    });
  } catch (e) {
    await recordAuditEvent({
      actorId: profile.id,
      actorRole: "customer",
      action: "payment.razorpay_order_creation_failed",
      targetTable: "multi_order_groups",
      targetId: groupId,
      reason: e instanceof Error ? e.message : "Unknown error",
    });
    return { ok: false, issues: ["Could not start payment. Please try again in a moment."] };
  }

  const { error: paymentError } = await supabase.from("payments").insert({
    group_id: groupId,
    customer_id: profile.id,
    razorpay_order_id: razorpayOrder.id,
    amount_paise: preview.grandTotalPaise,
    status: "created",
  });

  if (paymentError) {
    return { ok: false, issues: ["Could not start payment. Please try again."] };
  }

  return {
    ok: true,
    razorpayOrderId: razorpayOrder.id,
    amountPaise: preview.grandTotalPaise,
    keyId: process.env.RAZORPAY_KEY_ID!,
    customerName: profile.name,
    customerEmail: profile.email,
    customerPhone: profile.phone,
  };
}
