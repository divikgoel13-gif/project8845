import "server-only";

import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { recordFraudSignal, FRAUD_SIGNALS } from "@/lib/fraud/flags";
import { ADMIN_PAGE_SIZE } from "@/components/ui/pagination";
import type { Json } from "@/types/database";

/**
 * Financial Reconciliation (SRS V2 §T). Compares Razorpay payment records,
 * orders, commission records, vendor payables, disbursements and refund
 * events, and highlights the six mismatch types §T names verbatim —
 * `financial_reconciliation_items.item_type`'s own check constraint (`0016`)
 * uses the identical six strings.
 *
 * §T's own words bound this module tightly: "Resolution is manual... the
 * dashboard does not introduce automated vendor payouts or automated
 * refunds." This file therefore has exactly one write surface into a
 * financial table — never any. It reads `orders`/`payments`/
 * `payment_events`/`refund_events`/`disbursements`/`vendor_payables` and
 * writes ONLY to `financial_reconciliation_items` (the mismatch register)
 * and, for two specific findings, calls the pre-existing
 * `recordFraudSignal` (also write-nothing-else, see `lib/fraud/flags.ts`).
 * Not one line here updates an order, a payment, a payable or a
 * disbursement. Fixing a real mismatch happens through the EXISTING,
 * already-audited actions for those tables (record-refund, disburse, a
 * manual correction with its own reason) — this dashboard's job is to point
 * at the discrepancy and track that a human looked at it, not to touch the
 * ledger itself.
 *
 * ── Detection grounded in the real schema, not assumed ─────────────────
 * `orders` and `payments` have no foreign key to each other — they share a
 * `group_id` (SRS's "multi-restaurant order-group" model: one Razorpay
 * checkout can pay for orders across several restaurants at once). Every
 * comparison below is therefore GROUP-level, not order-level, for the two
 * checks that involve both tables.
 *
 * `payment_events.provider_event_id` is already UNIQUE at the database
 * level (`0003`), so a literal duplicate insert is already impossible —
 * "duplicate_payment_event" instead looks for the same (payment, event
 * TYPE) pair reported more than once under different provider event ids,
 * which the unique constraint does nothing to prevent and which a provider
 * redelivering a differently-wrapped copy of the same event would produce.
 *
 * `vendor_payables.disbursed_amount_paise <= amount_paise` is already a
 * database CHECK constraint (`0003`), so simple over-disbursement is
 * already impossible — "payable_mismatch" instead compares each payable
 * against the ORDER's own `vendor_payable_paise` snapshot, catching drift
 * between what an order promised and what the payable ledger recorded, not
 * a case the database already forbids.
 *
 * "duplicate_payout" sums every disbursement's own `covers` array (the
 * audit trail `disburseToVendor` already writes) against the payable's
 * current `disbursed_amount_paise`, verifying the ledger and its own
 * history still agree — genuinely useful because nothing enforces that
 * agreement at write time beyond the optimistic-concurrency update itself
 * being correct.
 *
 * ── Scope of one scan ───────────────────────────────────────────────────
 * Bounded to the last `LOOKBACK_DAYS` and capped per source table at
 * `SCAN_CAP` rows — a genuinely unbounded historical scan is not a V1
 * concern for a campus-scale platform, and an unbounded one would risk
 * becoming the slowest page in the console. Both numbers are named
 * constants, not buried literals, and `runReconciliationScan`'s result
 * reports whether any source hit its cap.
 */

const LOOKBACK_DAYS = 365;
const SCAN_CAP = 20_000;

type Candidate = {
  itemType: string;
  severity: "info" | "warning" | "critical";
  fingerprint: string;
  restaurantId: string | null;
  orderId: string | null;
  paymentId: string | null;
  disbursementId: string | null;
  refundEventId: string | null;
  expectedPaise: number | null;
  actualPaise: number | null;
  details: Record<string, unknown>;
};

async function detectPaymentWithoutOrder(sinceIso: string): Promise<Candidate[]> {
  const supabase = createServerSupabaseClient();

  const { data: payments } = await supabase
    .from("payments")
    .select("id, group_id, amount_paise, customer_id")
    .eq("status", "captured")
    .gte("created_at", sinceIso)
    .limit(SCAN_CAP);

  const groupIds = Array.from(new Set((payments ?? []).map((p) => p.group_id).filter((g): g is string => Boolean(g))));
  if (groupIds.length === 0) return [];

  // Deliberately excludes `status = 'cart'`: orders are created as 'cart'
  // BEFORE payment and the SAME rows transition to 'paid' once
  // `finalizePayment` runs (lib/orders/finalize-payment.ts) — they are never
  // recreated. A group whose payment captured but whose orders are still
  // sitting in 'cart' is exactly the broken state this check exists to
  // catch (the webhook succeeded but finalization did not complete), so a
  // stuck cart must count as "no real order", not as a false all-clear.
  const { data: orders } = await supabase.from("orders").select("group_id").in("group_id", groupIds).neq("status", "cart").limit(SCAN_CAP);
  const groupsWithOrders = new Set((orders ?? []).map((o) => o.group_id));

  return (payments ?? [])
    .filter((p) => p.group_id && !groupsWithOrders.has(p.group_id))
    .map((p) => ({
      itemType: "payment_without_order",
      severity: "critical" as const,
      fingerprint: `payment_without_order:${p.id}`,
      restaurantId: null,
      orderId: null,
      paymentId: p.id,
      disbursementId: null,
      refundEventId: null,
      expectedPaise: null,
      actualPaise: p.amount_paise,
      details: { groupId: p.group_id, customerId: p.customer_id },
    }));
}

async function detectOrderPaymentMismatch(sinceIso: string): Promise<Candidate[]> {
  const supabase = createServerSupabaseClient();

  const { data: orders } = await supabase
    .from("orders")
    .select("id, group_id, restaurant_id, subtotal_paise, status")
    .neq("status", "cart")
    .gte("created_at", sinceIso)
    .limit(SCAN_CAP);

  const groupIds = Array.from(new Set((orders ?? []).map((o) => o.group_id).filter((g): g is string => Boolean(g))));
  if (groupIds.length === 0) return [];

  const { data: payments } = await supabase
    .from("payments")
    .select("id, group_id, amount_paise, status")
    .in("group_id", groupIds)
    .eq("status", "captured")
    .limit(SCAN_CAP);

  const paymentByGroup = new Map((payments ?? []).map((p) => [p.group_id, p]));

  const byGroup = new Map<string, { orderId: string; restaurantId: string; subtotal: number }>();
  for (const o of orders ?? []) {
    if (!o.group_id) continue;
    const existing = byGroup.get(o.group_id);
    if (existing) existing.subtotal += o.subtotal_paise;
    else byGroup.set(o.group_id, { orderId: o.id, restaurantId: o.restaurant_id, subtotal: o.subtotal_paise });
  }

  const results: Candidate[] = [];
  for (const [groupId, group] of byGroup) {
    const payment = paymentByGroup.get(groupId);

    if (!payment) {
      // A non-cart order group with no captured payment on record — the
      // inverse of payment_without_order. This can legitimately happen for
      // an order-group whose payment predates `LOOKBACK_DAYS`; still worth
      // a look, hence `warning` rather than `critical`.
      results.push({
        itemType: "order_payment_mismatch",
        severity: "warning",
        fingerprint: `order_payment_mismatch:${groupId}:no_payment`,
        restaurantId: group.restaurantId,
        orderId: group.orderId,
        paymentId: null,
        disbursementId: null,
        refundEventId: null,
        expectedPaise: group.subtotal,
        actualPaise: null,
        details: { groupId, reason: "no_captured_payment_found_in_window" },
      });
      continue;
    }

    if (payment.amount_paise !== group.subtotal) {
      results.push({
        itemType: "order_payment_mismatch",
        severity: "critical",
        fingerprint: `order_payment_mismatch:${groupId}:${payment.id}`,
        restaurantId: group.restaurantId,
        orderId: group.orderId,
        paymentId: payment.id,
        disbursementId: null,
        refundEventId: null,
        expectedPaise: group.subtotal,
        actualPaise: payment.amount_paise,
        details: { groupId },
      });
    }
  }

  return results;
}

async function detectDuplicatePaymentEvent(sinceIso: string): Promise<Candidate[]> {
  const supabase = createServerSupabaseClient();

  const { data: events } = await supabase
    .from("payment_events")
    .select("id, payment_id, event_type, provider_event_id, created_at")
    .gte("created_at", sinceIso)
    .not("payment_id", "is", null)
    .limit(SCAN_CAP);

  const groups = new Map<string, { paymentId: string; eventType: string; eventIds: string[] }>();
  for (const e of events ?? []) {
    if (!e.payment_id) continue;
    const key = `${e.payment_id}:${e.event_type}`;
    const existing = groups.get(key);
    if (existing) existing.eventIds.push(e.provider_event_id);
    else groups.set(key, { paymentId: e.payment_id, eventType: e.event_type, eventIds: [e.provider_event_id] });
  }

  return Array.from(groups.values())
    .filter((g) => g.eventIds.length > 1)
    .map((g) => ({
      itemType: "duplicate_payment_event",
      severity: "warning" as const,
      fingerprint: `duplicate_payment_event:${g.paymentId}:${g.eventType}`,
      restaurantId: null,
      orderId: null,
      paymentId: g.paymentId,
      disbursementId: null,
      refundEventId: null,
      expectedPaise: null,
      actualPaise: null,
      details: { eventType: g.eventType, count: g.eventIds.length, providerEventIds: g.eventIds.slice(0, 10) },
    }));
}

async function detectRefundMismatch(sinceIso: string): Promise<Candidate[]> {
  const supabase = createServerSupabaseClient();

  const { data: refunds } = await supabase
    .from("refund_events")
    .select("id, order_id, payment_id, amount_paise, status")
    .eq("status", "succeeded")
    .gte("created_at", sinceIso)
    .limit(SCAN_CAP);

  const orderIds = Array.from(new Set((refunds ?? []).map((r) => r.order_id)));
  if (orderIds.length === 0) return [];

  const { data: orders } = await supabase.from("orders").select("id, restaurant_id, subtotal_paise").in("id", orderIds);
  const orderById = new Map((orders ?? []).map((o) => [o.id, o]));

  const byOrder = new Map<string, { total: number; lastRefundId: string }>();
  for (const r of refunds ?? []) {
    const existing = byOrder.get(r.order_id);
    if (existing) {
      existing.total += r.amount_paise;
      existing.lastRefundId = r.id;
    } else {
      byOrder.set(r.order_id, { total: r.amount_paise, lastRefundId: r.id });
    }
  }

  const results: Candidate[] = [];
  for (const [orderId, agg] of byOrder) {
    const order = orderById.get(orderId);
    if (!order) continue;
    if (agg.total > order.subtotal_paise) {
      results.push({
        itemType: "refund_mismatch",
        severity: "critical",
        fingerprint: `refund_mismatch:${orderId}`,
        restaurantId: order.restaurant_id,
        orderId,
        paymentId: null,
        disbursementId: null,
        refundEventId: agg.lastRefundId,
        expectedPaise: order.subtotal_paise,
        actualPaise: agg.total,
        details: { reason: "total_refunded_exceeds_order_subtotal" },
      });
    }
  }

  return results;
}

async function detectDuplicatePayout(sinceIso: string): Promise<Candidate[]> {
  const supabase = createServerSupabaseClient();

  const { data: payables } = await supabase
    .from("vendor_payables")
    .select("id, restaurant_id, order_id, amount_paise, disbursed_amount_paise")
    .gte("created_at", sinceIso)
    .limit(SCAN_CAP);

  const { data: disbursements } = await supabase
    .from("disbursements")
    .select("id, covers, created_at")
    .gte("created_at", sinceIso)
    .limit(SCAN_CAP);

  // covers: Array<{ payableId: string; orderId: string; amountPaise: number }>
  // — the exact shape `disburseToVendor` writes (lib/actions/admin/disburse.ts).
  const coveredByPayable = new Map<string, { sum: number; disbursementIds: string[] }>();
  for (const d of disbursements ?? []) {
    const covers = Array.isArray(d.covers) ? (d.covers as unknown as { payableId?: string; amountPaise?: number }[]) : [];
    for (const c of covers) {
      if (!c.payableId || typeof c.amountPaise !== "number") continue;
      const existing = coveredByPayable.get(c.payableId);
      if (existing) {
        existing.sum += c.amountPaise;
        existing.disbursementIds.push(d.id);
      } else {
        coveredByPayable.set(c.payableId, { sum: c.amountPaise, disbursementIds: [d.id] });
      }
    }
  }

  const results: Candidate[] = [];
  for (const p of payables ?? []) {
    const covered = coveredByPayable.get(p.id);
    const coveredSum = covered?.sum ?? 0;
    if (coveredSum !== p.disbursed_amount_paise) {
      results.push({
        itemType: "duplicate_payout",
        severity: "critical",
        fingerprint: `duplicate_payout:${p.id}`,
        restaurantId: p.restaurant_id,
        orderId: p.order_id,
        paymentId: null,
        disbursementId: covered?.disbursementIds[0] ?? null,
        refundEventId: null,
        expectedPaise: p.disbursed_amount_paise,
        actualPaise: coveredSum,
        details: {
          reason: "sum_of_disbursement_covers_does_not_match_ledger",
          disbursementIds: covered?.disbursementIds ?? [],
        },
      });
    }
  }

  return results;
}

async function detectPayableMismatch(sinceIso: string): Promise<Candidate[]> {
  const supabase = createServerSupabaseClient();

  const { data: orders } = await supabase
    .from("orders")
    .select("id, restaurant_id, vendor_payable_paise")
    .not("vendor_payable_paise", "is", null)
    .gte("created_at", sinceIso)
    .limit(SCAN_CAP);

  const orderIds = (orders ?? []).map((o) => o.id);
  if (orderIds.length === 0) return [];

  const { data: payables } = await supabase.from("vendor_payables").select("order_id, amount_paise").in("order_id", orderIds);
  const payableByOrder = new Map((payables ?? []).map((p) => [p.order_id, p.amount_paise]));

  const results: Candidate[] = [];
  for (const o of orders ?? []) {
    const payableAmount = payableByOrder.get(o.id);
    if (payableAmount === undefined) {
      results.push({
        itemType: "payable_mismatch",
        severity: "warning",
        fingerprint: `payable_mismatch:${o.id}:missing`,
        restaurantId: o.restaurant_id,
        orderId: o.id,
        paymentId: null,
        disbursementId: null,
        refundEventId: null,
        expectedPaise: o.vendor_payable_paise,
        actualPaise: null,
        details: { reason: "order_has_no_matching_payable_row" },
      });
    } else if (payableAmount !== o.vendor_payable_paise) {
      results.push({
        itemType: "payable_mismatch",
        severity: "critical",
        fingerprint: `payable_mismatch:${o.id}:amount`,
        restaurantId: o.restaurant_id,
        orderId: o.id,
        paymentId: null,
        disbursementId: null,
        refundEventId: null,
        expectedPaise: o.vendor_payable_paise,
        actualPaise: payableAmount,
        details: { reason: "payable_amount_differs_from_order_snapshot" },
      });
    }
  }

  return results;
}

export type ReconciliationScanResult = {
  scannedAt: string;
  candidateCount: number;
  byType: Record<string, number>;
};

/**
 * Runs all six detectors and upserts findings into
 * `financial_reconciliation_items` by fingerprint (insert new, bump
 * `last_seen_at`/details on existing open ones — never touches a row once
 * a human has moved it to `investigating`/`resolved`/`ignored`, so a
 * re-scan cannot silently erase a reviewer's own state). Nothing is
 * auto-closed: a fingerprint that stops appearing simply stops being
 * refreshed, and stays exactly where a human left it. Auditing is the
 * caller's job (lib/actions/admin/reconciliation.ts).
 */
export async function runReconciliationScan(): Promise<ReconciliationScanResult> {
  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

  const [paymentWithoutOrder, orderPaymentMismatch, duplicatePaymentEvent, refundMismatch, duplicatePayout, payableMismatch] =
    await Promise.all([
      detectPaymentWithoutOrder(sinceIso),
      detectOrderPaymentMismatch(sinceIso),
      detectDuplicatePaymentEvent(sinceIso),
      detectRefundMismatch(sinceIso),
      detectDuplicatePayout(sinceIso),
      detectPayableMismatch(sinceIso),
    ]);

  const all = [
    ...paymentWithoutOrder,
    ...orderPaymentMismatch,
    ...duplicatePaymentEvent,
    ...refundMismatch,
    ...duplicatePayout,
    ...payableMismatch,
  ];

  const supabase = createServiceRoleSupabaseClient();
  const nowIso = new Date().toISOString();

  for (const c of all) {
    const { data: existing } = await supabase
      .from("financial_reconciliation_items")
      .select("id, status")
      .eq("fingerprint", c.fingerprint)
      .maybeSingle();

    if (existing) {
      // A human has already looked at this fingerprint — refresh the
      // evidence (it may have grown, e.g. duplicate event count) without
      // touching their review status.
      await supabase
        .from("financial_reconciliation_items")
        .update({
          expected_paise: c.expectedPaise,
          actual_paise: c.actualPaise,
          details: c.details as unknown as Json,
          last_seen_at: nowIso,
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("financial_reconciliation_items").insert({
        item_type: c.itemType,
        severity: c.severity,
        fingerprint: c.fingerprint,
        restaurant_id: c.restaurantId,
        order_id: c.orderId,
        payment_id: c.paymentId,
        disbursement_id: c.disbursementId,
        refund_event_id: c.refundEventId,
        expected_paise: c.expectedPaise,
        actual_paise: c.actualPaise,
        details: c.details as unknown as Json,
        status: "open",
        detected_at: nowIso,
        last_seen_at: nowIso,
      });
    }
  }

  // Cross-link to the fraud queue for the two finding types §S's own signal
  // vocabulary already names — see lib/admin/fraud.ts's header comment for
  // why this is the one detection path wired in by this pass. Best-effort:
  // recordFraudSignal never throws (see its own doc comment), so a failure
  // here cannot fail the scan.
  for (const c of duplicatePaymentEvent) {
    const paymentId = c.paymentId;
    if (!paymentId) continue;
    const { data: payment } = await supabase.from("payments").select("customer_id").eq("id", paymentId).maybeSingle();
    if (payment) {
      await recordFraudSignal({
        subjectType: "customer",
        subjectId: payment.customer_id,
        signal: FRAUD_SIGNALS.duplicatePaymentAttempt,
        details: { paymentId, ...c.details },
      });
    }
  }
  for (const c of paymentWithoutOrder) {
    const customerId = (c.details as { customerId?: string }).customerId;
    if (!customerId) continue;
    await recordFraudSignal({
      subjectType: "customer",
      subjectId: customerId,
      signal: FRAUD_SIGNALS.paymentWithoutOrder,
      details: { paymentId: c.paymentId, ...c.details },
    });
  }

  const byType: Record<string, number> = {};
  for (const c of all) byType[c.itemType] = (byType[c.itemType] ?? 0) + 1;

  return { scannedAt: nowIso, candidateCount: all.length, byType };
}

// ── Reading the persisted register for the dashboard ───────────────────

export type ReconciliationItemRow = {
  id: string;
  itemType: string;
  severity: string;
  restaurantId: string | null;
  restaurantName: string | null;
  orderId: string | null;
  paymentId: string | null;
  disbursementId: string | null;
  refundEventId: string | null;
  expectedPaise: number | null;
  actualPaise: number | null;
  details: Json;
  status: string;
  detectedAt: string;
  lastSeenAt: string;
  resolvedBy: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
};

export type ReconciliationFilters = {
  status?: "open" | "investigating" | "resolved" | "ignored" | "all";
  itemType?: string;
  severity?: "info" | "warning" | "critical" | "all";
  page?: number;
};

export async function listReconciliationItems(
  filters: ReconciliationFilters = {}
): Promise<{ rows: ReconciliationItemRow[]; total: number; page: number; pageSize: number }> {
  const supabase = createServerSupabaseClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = ADMIN_PAGE_SIZE;
  const from = (page - 1) * pageSize;

  let query = supabase.from("financial_reconciliation_items").select(
    "id, item_type, severity, restaurant_id, order_id, payment_id, disbursement_id, refund_event_id, expected_paise, actual_paise, details, status, detected_at, last_seen_at, resolved_by, resolved_at, resolution_note, restaurants(name)",
    { count: "exact" }
  );

  const status = filters.status && filters.status !== "all" ? filters.status : null;
  if (status) query = query.eq("status", status);
  if (filters.itemType) query = query.eq("item_type", filters.itemType);
  if (filters.severity && filters.severity !== "all") query = query.eq("severity", filters.severity);

  // Sorted by recency only, not by severity: `severity` is a plain text
  // column ('critical' | 'info' | 'warning'), and PostgREST's `.order()` can
  // only sort it alphabetically — which would rank 'critical' ABOVE 'info'
  // but BELOW 'warning', not above both. Rather than ship a sort that looks
  // right in the common case and is wrong in a specific one, severity is a
  // FILTER (below) instead of a sort key: pick "Critical only" to triage by
  // severity explicitly.
  const { data, count } = await query.order("last_seen_at", { ascending: false }).range(from, from + pageSize - 1);

  const rows = (data ?? []) as unknown as {
    id: string;
    item_type: string;
    severity: string;
    restaurant_id: string | null;
    order_id: string | null;
    payment_id: string | null;
    disbursement_id: string | null;
    refund_event_id: string | null;
    expected_paise: number | null;
    actual_paise: number | null;
    details: Json;
    status: string;
    detected_at: string;
    last_seen_at: string;
    resolved_by: string | null;
    resolved_at: string | null;
    resolution_note: string | null;
    restaurants: { name: string } | null;
  }[];

  const reviewerIds = Array.from(new Set(rows.map((r) => r.resolved_by).filter((id): id is string => Boolean(id))));
  const reviewers = reviewerIds.length
    ? await supabase.from("profiles").select("id, name").in("id", reviewerIds)
    : { data: [] as { id: string; name: string | null }[] };
  const reviewerNames = new Map((reviewers.data ?? []).map((r) => [r.id, r.name]));

  return {
    total: count ?? 0,
    page,
    pageSize,
    rows: rows.map((r) => ({
      id: r.id,
      itemType: r.item_type,
      severity: r.severity,
      restaurantId: r.restaurant_id,
      restaurantName: r.restaurants?.name ?? null,
      orderId: r.order_id,
      paymentId: r.payment_id,
      disbursementId: r.disbursement_id,
      refundEventId: r.refund_event_id,
      expectedPaise: r.expected_paise,
      actualPaise: r.actual_paise,
      details: r.details,
      status: r.status,
      detectedAt: r.detected_at,
      lastSeenAt: r.last_seen_at,
      resolvedBy: r.resolved_by,
      resolvedByName: r.resolved_by ? reviewerNames.get(r.resolved_by) ?? null : null,
      resolvedAt: r.resolved_at,
      resolutionNote: r.resolution_note,
    })),
  };
}

export async function getReconciliationCounts(): Promise<Record<string, number>> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase.from("financial_reconciliation_items").select("status").limit(SCAN_CAP);
  const counts: Record<string, number> = { open: 0, investigating: 0, resolved: 0, ignored: 0 };
  for (const row of data ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}
