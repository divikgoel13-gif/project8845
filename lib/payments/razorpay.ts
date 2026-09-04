import "server-only";
import crypto from "node:crypto";

/**
 * Thin Razorpay REST API client using fetch + Basic auth — no SDK
 * dependency, since the exact behavior of an installed SDK couldn't be
 * verified in this sandbox (no network for `npm install`). Every method
 * here was written against Razorpay's current documented API contract,
 * confirmed via web search on 2026-08-27 (not from training-data memory
 * alone, since payment-security code is exactly where stale/misremembered
 * details are most dangerous):
 *
 *   - Orders API:      POST /v1/orders            (razorpay.com/docs/api/orders/)
 *   - Payments fetch:  GET  /v1/payments/:id       (razorpay.com/docs/api/payments/)
 *   - Capture:         POST /v1/payments/:id/capture (razorpay.com/docs/api/payments/capture/)
 *   - Checkout signature: HMAC-SHA256(order_id + "|" + payment_id, key_secret)
 *     (razorpay.com/docs/payments/third-party-validation/standard-integration/)
 *   - Webhook signature:  HMAC-SHA256(raw_body, webhook_secret), hex,
 *     compared against the X-Razorpay-Signature header
 *     (razorpay.com/docs/webhooks/validate-test/)
 *
 * This has NOT been run against Razorpay's actual API (no network access
 * in this environment) — treat as carefully-researched but unverified.
 * First integration task: run a real test-mode payment through this code
 * and confirm each step against Razorpay's dashboard logs.
 */

const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";

function authHeader(): string {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not configured.");
  }
  return "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");
}

export type RazorpayOrder = {
  id: string;
  amount: number; // paise
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string | null;
  status: "created" | "attempted" | "paid";
};

export type RazorpayPayment = {
  id: string;
  order_id: string | null;
  amount: number; // paise
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  captured: boolean;
  method: string;
  amount_refunded: number;
};

/**
 * Creates a Razorpay Order for the given amount. `receipt` should be a
 * value we can trace back to our own records (we use the UNI8
 * multi_order_groups.id) — Razorpay's own docs note this is how you tie
 * their order back to yours. `capture: "automatic"` is set explicitly per
 * order rather than relying on a dashboard-wide setting, since we can't
 * verify dashboard configuration from code — see also `capturePayment`
 * below, which is called defensively in case a payment still comes back
 * `authorized` rather than `captured`.
 */
export async function createRazorpayOrder(
  amountPaise: number,
  receipt: string,
  notes: Record<string, string>
): Promise<RazorpayOrder> {
  const res = await fetch(`${RAZORPAY_API_BASE}/orders`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: authHeader() },
    body: JSON.stringify({
      amount: amountPaise,
      currency: "INR",
      receipt,
      notes,
      payment: { capture: "automatic" },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Razorpay order creation failed (${res.status}): ${body}`);
  }

  return res.json();
}

export async function fetchRazorpayPayment(paymentId: string): Promise<RazorpayPayment> {
  const res = await fetch(`${RAZORPAY_API_BASE}/payments/${paymentId}`, {
    headers: { authorization: authHeader() },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Razorpay payment fetch failed (${res.status}): ${body}`);
  }

  return res.json();
}

/**
 * Defensive capture call for a payment stuck in `authorized` — should be
 * unnecessary given `capture: "automatic"` on order creation, but payment
 * capture is exactly the step where "should be unnecessary" isn't good
 * enough (an uncaptured authorization auto-voids after ~5 days and the
 * customer never actually gets charged, silently). Idempotent: capturing
 * an already-captured payment is a documented no-op/error we treat as
 * success by re-fetching afterward — see lib/orders/finalize-payment.ts.
 */
export async function capturePayment(paymentId: string, amountPaise: number): Promise<RazorpayPayment> {
  const res = await fetch(`${RAZORPAY_API_BASE}/payments/${paymentId}/capture`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: authHeader() },
    body: JSON.stringify({ amount: amountPaise, currency: "INR" }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Razorpay capture failed (${res.status}): ${body}`);
  }

  return res.json();
}

/**
 * Verifies the signature Razorpay Checkout returns to the browser after a
 * successful payment. MUST be re-verified server-side — the browser
 * cannot be trusted to report its own payment success (SRS §17, §9:
 * "No order confirmation based only on browser redirect.").
 */
export function verifyCheckoutSignature(
  ourRazorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string
): boolean {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) throw new Error("RAZORPAY_KEY_SECRET is not configured.");

  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`${ourRazorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  return timingSafeEqualHex(expected, razorpaySignature);
}

/**
 * Verifies an incoming webhook's X-Razorpay-Signature against the RAW
 * request body (must be verified before JSON.parse — see the route
 * handler). This is the AUTHORITATIVE payment-confirmation path; the
 * client-callback path above is a UX accelerant, not a substitute for
 * this (SRS §12: "webhooks are authoritative").
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error("RAZORPAY_WEBHOOK_SECRET is not configured.");
  if (!signatureHeader) return false;

  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return timingSafeEqualHex(expected, signatureHeader);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
