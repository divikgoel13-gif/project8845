import "server-only";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { STORAGE_BUCKETS } from "@/lib/storage/buckets";
import type { Enums } from "@/types/database";

/**
 * Vendor financial read-side (SRS Phase 6: "Vendor Payments page," "Vendor
 * payable calculations," "Outstanding payable view," "Per-order financial
 * breakdown," "Vendor disbursement history," "Vendor proof viewing").
 *
 * The single source of truth for what UNI8 owes a restaurant is the
 * `vendor_payables` ledger: exactly one row is written per paid order (by
 * lib/orders/finalize-payment.ts), with `amount_paise` = that order's
 * `vendor_payable_paise` — which was itself snapshotted at checkout as
 * subtotal − commission using the commission rate in force AT THAT TIME
 * (lib/actions/customer/checkout.ts). Reading the ledger rather than
 * recomputing gross×(1−rate) here is what makes the Phase 6 completion
 * standard "Vendor payable reconciles with paid orders and commission
 * logic" and the §V requirement "historical orders snapshot the commission
 * rate used for that order so future configuration changes do not rewrite
 * historical financials" hold by construction: a later commission-rate
 * change cannot retroactively move a single number on this page.
 *
 * Every function is restaurant-scoped. The RLS policy
 * `vendor_payables_select_scoped` / `disbursements_select_scoped` already
 * restricts the RLS-bound client to restaurants the caller manages, and the
 * page-level guard (requireRestaurantScope) validates the restaurantId
 * before these are called — the explicit `.eq("restaurant_id", ...)` is
 * defense-in-depth on top of both.
 */

export type VendorPayableSummary = {
  paidOrderCount: number;
  grossSalesPaise: number;
  commissionPaise: number;
  /** Gross − commission = the total UNI8 has ever owed this restaurant. */
  netPayablePaise: number;
  disbursedPaise: number;
  /** netPayable − disbursed = what is still owed right now. */
  outstandingPaise: number;
};

export type VendorPayableOrderRow = {
  orderId: string;
  createdAt: string;
  pickupTime: string | null;
  status: Enums<"order_status">;
  grossPaise: number;
  commissionRateSnapshot: number | null;
  commissionPaise: number;
  payablePaise: number;
  disbursedPaise: number;
  outstandingPaise: number;
};

export type VendorDisbursementRow = {
  id: string;
  amountPaise: number;
  status: Enums<"disbursement_status">;
  reference: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  coversOrderCount: number;
  /** Short-lived signed URL to the private proof object, or null if unreadable. */
  proofUrl: string | null;
  escalatedTicketId: string | null;
};

type PayableJoinRow = {
  id: string;
  amount_paise: number;
  disbursed_amount_paise: number;
  order_id: string;
  orders: {
    created_at: string;
    pickup_time: string | null;
    status: Enums<"order_status">;
    subtotal_paise: number;
    commission_rate_snapshot: number | null;
    commission_amount_paise: number | null;
  } | null;
};

async function loadPayables(restaurantId: string): Promise<PayableJoinRow[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("vendor_payables")
    .select(
      "id, amount_paise, disbursed_amount_paise, order_id, orders(created_at, pickup_time, status, subtotal_paise, commission_rate_snapshot, commission_amount_paise)"
    )
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data as unknown as PayableJoinRow[];
}

export async function getVendorPayableSummary(restaurantId: string): Promise<VendorPayableSummary> {
  const payables = await loadPayables(restaurantId);

  let grossSalesPaise = 0;
  let netPayablePaise = 0;
  let disbursedPaise = 0;

  for (const p of payables) {
    grossSalesPaise += p.orders?.subtotal_paise ?? 0;
    netPayablePaise += p.amount_paise;
    disbursedPaise += p.disbursed_amount_paise;
  }

  return {
    paidOrderCount: payables.length,
    grossSalesPaise,
    commissionPaise: grossSalesPaise - netPayablePaise,
    netPayablePaise,
    disbursedPaise,
    outstandingPaise: netPayablePaise - disbursedPaise,
  };
}

export async function listVendorPayableOrders(restaurantId: string): Promise<VendorPayableOrderRow[]> {
  const payables = await loadPayables(restaurantId);

  return payables.map((p) => ({
    orderId: p.order_id,
    createdAt: p.orders?.created_at ?? "",
    pickupTime: p.orders?.pickup_time ?? null,
    status: p.orders?.status ?? "paid",
    grossPaise: p.orders?.subtotal_paise ?? 0,
    commissionRateSnapshot: p.orders?.commission_rate_snapshot ?? null,
    commissionPaise: p.orders?.commission_amount_paise ?? (p.orders?.subtotal_paise ?? 0) - p.amount_paise,
    payablePaise: p.amount_paise,
    disbursedPaise: p.disbursed_amount_paise,
    outstandingPaise: p.amount_paise - p.disbursed_amount_paise,
  }));
}

export async function listVendorDisbursements(restaurantId: string): Promise<VendorDisbursementRow[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("disbursements")
    .select("id, amount_paise, status, reference, created_at, acknowledged_at, covers, proof_path, not_received_escalated_ticket_id")
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  // Signed URLs come from the service-role client so a private-bucket read
  // works regardless of storage RLS — safe because we've already scoped the
  // query to this restaurant (RLS + the guard above) and only hand back a
  // short-lived URL, never the raw path.
  const service = createServiceRoleSupabaseClient();

  const rows: VendorDisbursementRow[] = [];
  for (const d of data) {
    let proofUrl: string | null = null;
    if (d.proof_path) {
      const { data: signed } = await service.storage
        .from(STORAGE_BUCKETS.payoutProofs)
        .createSignedUrl(d.proof_path, 300);
      proofUrl = signed?.signedUrl ?? null;
    }

    const covers = Array.isArray(d.covers) ? (d.covers as unknown[]) : [];

    rows.push({
      id: d.id,
      amountPaise: d.amount_paise,
      status: d.status,
      reference: d.reference,
      createdAt: d.created_at,
      acknowledgedAt: d.acknowledged_at,
      coversOrderCount: covers.length,
      proofUrl,
      escalatedTicketId: d.not_received_escalated_ticket_id,
    });
  }

  return rows;
}
