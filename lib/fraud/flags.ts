import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

/**
 * Fraud & abuse signal recording (SRS V2 §S).
 *
 * The governing sentence is "Detection must record flags without automatically
 * banning". So this module has exactly one write path — `recordFraudSignal` —
 * and it does nothing except insert or bump a row. It never disables an account,
 * never cancels an order, never blocks a scan. A human reviews the queue in
 * /admin/fraud and takes any action explicitly, where it gets audited.
 *
 * Two further §S requirements shape the shape of the data:
 *
 *  - "Signals must be data-driven and auditable." Hence `details` jsonb: the row
 *    records the evidence (counts, order ids, timestamps) that triggered it, so
 *    a reviewer can judge the flag rather than trust it.
 *
 *  - "Reviewable" implies a queue that stays readable. A repeated detection
 *    therefore increments `occurrences` and moves `last_seen_at` on the existing
 *    open flag (enforced by uq_fraud_flags_open_signal in 0016) instead of
 *    inserting a duplicate. Without that, one student retrying a failing QR scan
 *    forty times would bury every other signal.
 *
 * Like recordAuditEvent, this deliberately never throws. A failure to record a
 * fraud signal must not fail the operation that noticed it — refusing a
 * customer's checkout because a telemetry insert failed would be a worse outcome
 * than a missing flag.
 */

export const FRAUD_SIGNALS = {
  excessiveFailedScans: "repeated_failed_scan",
  scanOutsideWindow: "scan_outside_pickup_window",
  crossRestaurantScanAttempt: "cross_restaurant_scan_attempt",
  repeatedNoShows: "repeated_no_shows",
  repeatedCancellations: "repeated_customer_cancellations",
  highRefundRate: "high_refund_rate",
  duplicatePaymentAttempt: "duplicate_payment_attempt",
  paymentWithoutOrder: "payment_without_order",
  vendorExcessiveCancellations: "vendor_excessive_cancellations",
  vendorPrematureReady: "vendor_premature_ready_marking",
} as const;

export type FraudSignal = (typeof FRAUD_SIGNALS)[keyof typeof FRAUD_SIGNALS];

export type FraudSubjectType = "customer" | "vendor" | "qr";

export type FraudSignalInput = {
  subjectType: FraudSubjectType;
  /** profiles.id for customer, restaurants.id for vendor, group/order id for qr. */
  subjectId: string;
  signal: string;
  details?: Record<string, unknown>;
};

export async function recordFraudSignal(input: FraudSignalInput): Promise<void> {
  try {
    const supabase = createServiceRoleSupabaseClient();
    const nowIso = new Date().toISOString();

    // Is there already an unresolved flag for this exact (subject, signal)?
    const { data: existing } = await supabase
      .from("fraud_flags")
      .select("id, occurrences, details")
      .eq("subject_type", input.subjectType)
      .eq("subject_id", input.subjectId)
      .eq("signal", input.signal)
      .in("status", ["open", "investigating"])
      .maybeSingle();

    if (existing) {
      const mergedDetails = {
        ...(typeof existing.details === "object" && existing.details && !Array.isArray(existing.details)
          ? (existing.details as Record<string, unknown>)
          : {}),
        latest: input.details ?? {},
      };

      await supabase
        .from("fraud_flags")
        .update({
          occurrences: (existing.occurrences ?? 1) + 1,
          last_seen_at: nowIso,
          details: mergedDetails as unknown as Json,
        })
        .eq("id", existing.id);

      return;
    }

    await supabase.from("fraud_flags").insert({
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      signal: input.signal,
      details: (input.details ?? {}) as unknown as Json,
      status: "open",
      occurrences: 1,
      last_seen_at: nowIso,
    });
  } catch (error) {
    // Same posture as lib/audit/log.ts: log, do not propagate.
    console.error("[fraud] failed to record signal", input.signal, error);
  }
}

/**
 * Human-readable label per signal, for the review queue. Kept next to the
 * signal constants so adding a signal without a label is obvious in review.
 */
export const FRAUD_SIGNAL_LABELS: Record<string, string> = {
  [FRAUD_SIGNALS.excessiveFailedScans]: "Repeated failed QR scans",
  [FRAUD_SIGNALS.scanOutsideWindow]: "QR scanned outside the pickup window",
  [FRAUD_SIGNALS.crossRestaurantScanAttempt]: "QR presented at the wrong restaurant",
  [FRAUD_SIGNALS.repeatedNoShows]: "Repeated no-shows",
  [FRAUD_SIGNALS.repeatedCancellations]: "Frequent customer cancellations",
  [FRAUD_SIGNALS.highRefundRate]: "High refund rate",
  [FRAUD_SIGNALS.duplicatePaymentAttempt]: "Duplicate payment attempt",
  [FRAUD_SIGNALS.paymentWithoutOrder]: "Payment with no matching order",
  [FRAUD_SIGNALS.vendorExcessiveCancellations]: "Vendor cancelling excessively",
  [FRAUD_SIGNALS.vendorPrematureReady]: "Orders marked ready implausibly early",
};

export function fraudSignalLabel(signal: string): string {
  return FRAUD_SIGNAL_LABELS[signal] ?? signal.replace(/_/g, " ");
}
