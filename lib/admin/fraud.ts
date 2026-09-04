import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fraudSignalLabel } from "@/lib/fraud/flags";
import type { Json } from "@/types/database";

/**
 * Fraud & abuse review queue (SRS V2 §S). `lib/fraud/flags.ts` already owns
 * detection and recording (`recordFraudSignal`) — this module is the other
 * half §S names explicitly: "Super Admin can acknowledge, investigate and
 * resolve flags." Detection never bans, disables or blocks anything by
 * itself; every consequence here is a human decision made on this page.
 *
 * `fraud_flags.status` has four values (`open`, `investigating`, `resolved`,
 * `dismissed` — see `0004`'s check constraint), not a separate
 * "acknowledged" state. §S's "acknowledge" maps onto moving a flag to
 * `investigating`: starting a review IS the acknowledgment, since a
 * fifth status just for "seen but not yet looked at" would fork the same
 * meaning two ways.
 *
 * `subject_id` means a different table depending on `subject_type`
 * (documented on `FraudSignalInput` in `lib/fraud/flags.ts`: profiles.id for
 * a customer, restaurants.id for a vendor, an order id for a QR signal).
 * This module resolves that per row so the queue reads as names and links,
 * not raw UUIDs — but see the honesty note below.
 *
 * IMPORTANT — this queue's honest current state: `recordFraudSignal` exists
 * and is fully correct, but as of this pass NOTHING in the codebase calls
 * it yet (no scan handler, OTP flow, cancellation action, or payout job
 * wires detection in). This page will show zero rows until that wiring is
 * added — see docs/PHASE_STATUS.md's Part D "Known gaps" for why that
 * wiring was deliberately left out of this pass rather than retrofitted
 * into five other phases' already-shipped flows. The one exception: this
 * pass's own Financial Reconciliation scan
 * (lib/admin/reconciliation.ts) calls `recordFraudSignal` directly for the
 * two signal types it can detect safely from data it already reads
 * (`duplicatePaymentAttempt`, `paymentWithoutOrder`), so the queue is not
 * permanently empty in the codebase as delivered.
 */

export type FraudQueueRow = {
  id: string;
  subjectType: string;
  subjectId: string;
  subjectLabel: string;
  subjectHref: string | null;
  signal: string;
  signalLabel: string;
  details: Json;
  status: string;
  occurrences: number;
  reviewedBy: string | null;
  reviewedByName: string | null;
  resolutionNote: string | null;
  createdAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
};

export type FraudQueueFilters = {
  status?: "open" | "investigating" | "resolved" | "dismissed" | "all";
  subjectType?: "customer" | "vendor" | "qr" | "all";
};

const SCAN_CAP = 2_000;

export async function listFraudQueue(filters: FraudQueueFilters = {}): Promise<{ rows: FraudQueueRow[]; truncated: boolean }> {
  const supabase = createServerSupabaseClient();

  let query = supabase
    .from("fraud_flags")
    .select(
      "id, subject_type, subject_id, signal, details, status, occurrences, reviewed_by, resolution_note, created_at, last_seen_at, resolved_at",
      { count: "exact" }
    );

  const status = filters.status && filters.status !== "all" ? filters.status : null;
  const subjectType = filters.subjectType && filters.subjectType !== "all" ? filters.subjectType : null;
  if (status) query = query.eq("status", status);
  if (subjectType) query = query.eq("subject_type", subjectType);

  const { data, count } = await query.order("last_seen_at", { ascending: false }).limit(SCAN_CAP);
  const rows = data ?? [];
  const truncated = (count ?? rows.length) > rows.length;

  // Resolve subject labels/links and reviewer names in three small batched
  // lookups rather than one per row — campus scale keeps this cheap, the
  // same discipline the rest of Phase 9 already uses.
  const customerIds = rows.filter((r) => r.subject_type === "customer").map((r) => r.subject_id);
  const vendorIds = rows.filter((r) => r.subject_type === "vendor").map((r) => r.subject_id);
  const qrIds = rows.filter((r) => r.subject_type === "qr").map((r) => r.subject_id);
  const reviewerIds = rows.map((r) => r.reviewed_by).filter((id): id is string => Boolean(id));

  const [customers, vendors, orders, reviewers] = await Promise.all([
    customerIds.length ? supabase.from("profiles").select("id, name").in("id", customerIds) : Promise.resolve({ data: [] }),
    vendorIds.length ? supabase.from("restaurants").select("id, name").in("id", vendorIds) : Promise.resolve({ data: [] }),
    qrIds.length ? supabase.from("orders").select("id").in("id", qrIds) : Promise.resolve({ data: [] }),
    reviewerIds.length ? supabase.from("profiles").select("id, name").in("id", reviewerIds) : Promise.resolve({ data: [] }),
  ]);

  const customerNames = new Map((customers.data ?? []).map((c) => [c.id, c.name]));
  const vendorNames = new Map((vendors.data ?? []).map((v) => [v.id, v.name]));
  const orderIds = new Set((orders.data ?? []).map((o) => o.id));
  const reviewerNames = new Map((reviewers.data ?? []).map((r) => [r.id, r.name]));

  return {
    truncated,
    rows: rows.map((r) => {
      let subjectLabel = r.subject_id;
      let subjectHref: string | null = null;

      if (r.subject_type === "customer") {
        subjectLabel = customerNames.get(r.subject_id) ?? "Unknown customer";
        subjectHref = `/admin/customers/${r.subject_id}`;
      } else if (r.subject_type === "vendor") {
        subjectLabel = vendorNames.get(r.subject_id) ?? "Unknown restaurant";
        subjectHref = `/admin/restaurants/${r.subject_id}`;
      } else if (r.subject_type === "qr") {
        // subject_id is documented as "group/order id" — this codebase has
        // no separate `order_groups` table (a group is just a shared
        // `group_id` value on `orders`/`payments`), so the only resolvable
        // case is a direct order id. If it doesn't match a known order, the
        // raw id is shown rather than guessed at — a wrong link is worse
        // than no link.
        if (orderIds.has(r.subject_id)) subjectHref = `/admin/orders/${r.subject_id}`;
        subjectLabel = orderIds.has(r.subject_id) ? `Order ${r.subject_id.slice(0, 8)}` : r.subject_id;
      }

      return {
        id: r.id,
        subjectType: r.subject_type,
        subjectId: r.subject_id,
        subjectLabel,
        subjectHref,
        signal: r.signal,
        signalLabel: fraudSignalLabel(r.signal),
        details: r.details,
        status: r.status,
        occurrences: r.occurrences,
        reviewedBy: r.reviewed_by,
        reviewedByName: r.reviewed_by ? reviewerNames.get(r.reviewed_by) ?? null : null,
        resolutionNote: r.resolution_note,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        resolvedAt: r.resolved_at,
      };
    }),
  };
}

export async function getFraudQueueCounts(): Promise<Record<string, number>> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase.from("fraud_flags").select("status").limit(SCAN_CAP);
  const counts: Record<string, number> = { open: 0, investigating: 0, resolved: 0, dismissed: 0 };
  for (const row of data ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}
