import { NextResponse, type NextRequest } from "next/server";
import { verifyWebhookSignature } from "@/lib/payments/razorpay";
import { finalizePayment } from "@/lib/orders/finalize-payment";
import { recordAuditEvent } from "@/lib/audit/log";

// Signature verification uses Node's `crypto` module — must NOT run on
// the Edge runtime.
export const runtime = "nodejs";

/**
 * Razorpay webhook endpoint (SRS §3, §12: "Payment verification/webhooks
 * are authoritative"). Configure this URL in the Razorpay Dashboard under
 * Settings → Webhooks, subscribed to at minimum `payment.captured` and
 * `payment.failed`.
 *
 * CRITICAL ORDERING: the raw body is read and signature-verified BEFORE
 * any JSON parsing happens. Razorpay's own docs are explicit that the
 * signature must be computed over the exact raw bytes — parsing and
 * re-serializing (e.g. `JSON.stringify(await req.json())`) can produce a
 * byte-for-byte different string and break verification even when the
 * payload is genuine. See lib/payments/razorpay.ts's doc comment for the
 * sources this was verified against.
 *
 * De-duplication uses the `x-razorpay-event-id` header, which Razorpay's
 * docs describe as unique per delivery and their own recommended
 * mechanism for detecting webhook retries — passed through to
 * finalizePayment as the idempotency key.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature");
  const eventId = req.headers.get("x-razorpay-event-id");

  let signatureValid: boolean;
  try {
    signatureValid = verifyWebhookSignature(rawBody, signature);
  } catch (e) {
    // Misconfiguration (missing RAZORPAY_WEBHOOK_SECRET) — fail loudly in
    // logs, but still return a non-2xx so Razorpay retries once it's fixed.
    console.error("[webhook:razorpay] signature verification error", e);
    return NextResponse.json({ error: "Server misconfiguration." }, { status: 500 });
  }

  if (!signatureValid) {
    await recordAuditEvent({
      actorId: null,
      actorRole: null,
      action: "webhook.razorpay_invalid_signature",
      reason: `event_id=${eventId ?? "unknown"}`,
    });
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  if (!eventId) {
    // Should never happen for a genuine Razorpay delivery, but without an
    // event id we have no safe idempotency key — reject rather than risk
    // double-processing.
    return NextResponse.json({ error: "Missing event id." }, { status: 400 });
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const eventType: string = body.event;
  const paymentEntity = body.payload?.payment?.entity;

  // Only payment.captured actually confirms money moved — payment.failed
  // and other subscribed events are acknowledged (200) but don't trigger
  // order finalization. Recording payment.failed here for audit purposes
  // is the "Payment/order exception handling" deliverable's other half:
  // failures are visible, not silently dropped.
  if (eventType !== "payment.captured") {
    await recordAuditEvent({
      actorId: null,
      actorRole: null,
      action: `webhook.razorpay_received_${eventType ?? "unknown"}`,
      reason: `event_id=${eventId}`,
    });
    return NextResponse.json({ received: true });
  }

  if (!paymentEntity?.id || !paymentEntity?.order_id) {
    return NextResponse.json({ error: "Malformed payment.captured payload." }, { status: 400 });
  }

  const result = await finalizePayment({
    razorpayOrderId: paymentEntity.order_id,
    razorpayPaymentId: paymentEntity.id,
    providerEventId: eventId,
    eventType,
    rawPayload: body,
  });

  if (!result.ok) {
    // Return 200 anyway for reasons that are permanent (won't be fixed by
    // a retry) vs 500 for transient ones would be the ideal split; for
    // V1 simplicity we return 200 whenever finalizePayment itself ran
    // without throwing (it already recorded an audit event internally for
    // every failure branch) so Razorpay doesn't retry-storm us for
    // conditions like "amount mismatch" that a retry can't fix anyway.
    // Genuine transient failures (network errors calling Razorpay's own
    // API) are logged and DO throw before reaching here, producing a 500
    // and a legitimate retry.
    console.warn("[webhook:razorpay] finalizePayment did not succeed:", result.reason);
  }

  return NextResponse.json({ received: true });
}
