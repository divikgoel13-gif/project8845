"use server";

import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { verifyCheckoutSignature } from "@/lib/payments/razorpay";
import { finalizePayment } from "@/lib/orders/finalize-payment";

const VerifySchema = z.object({
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

export type VerifyPaymentResult = { ok: true; orderIds: string[] } | { ok: false; error: string };

/**
 * Called immediately after Razorpay Checkout's success handler fires in
 * the browser (components/customer/razorpay-checkout-button.tsx). This is
 * a UX accelerant ONLY — it lets the customer see their confirmed order
 * without waiting for the webhook round-trip. It is NOT trusted as the
 * source of truth for whether payment succeeded (SRS §9: "No order
 * confirmation based only on browser redirect."):
 *
 *   1. The signature Checkout returned is verified server-side first
 *      (proves the callback data came from Razorpay, not a tampered
 *      client).
 *   2. Even after that, this calls the exact same `finalizePayment` the
 *      webhook calls, which independently re-fetches the payment from
 *      Razorpay's API rather than trusting anything the browser reported.
 *
 * If the webhook happens to arrive first (races with this call), or this
 * call happens to arrive first and the webhook arrives moments later,
 * `finalizePayment`'s idempotency guards (see its own doc comment) make
 * either order safe — whichever gets there first does the work, the
 * other short-circuits as `alreadyProcessed`.
 */
export async function verifyPaymentAndGetOrders(input: unknown): Promise<VerifyPaymentResult> {
  await requireRole("customer");
  const parsed = VerifySchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: "Invalid payment verification request." };
  }

  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = parsed.data;

  const signatureValid = verifyCheckoutSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
  if (!signatureValid) {
    return { ok: false, error: "Payment signature could not be verified." };
  }

  const result = await finalizePayment({
    razorpayOrderId,
    razorpayPaymentId,
    providerEventId: `client_verify:${razorpayPaymentId}`,
    eventType: "client.checkout_verify",
    rawPayload: { razorpayOrderId, razorpayPaymentId },
  });

  if (!result.ok) {
    return { ok: false, error: result.reason };
  }

  return { ok: true, orderIds: result.orderIds };
}
