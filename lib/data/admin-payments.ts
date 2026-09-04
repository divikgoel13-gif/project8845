import "server-only";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { STORAGE_BUCKETS } from "@/lib/storage/buckets";
import type { Enums } from "@/types/database";

/**
 * Super-Admin payments read-side (SRS Phase 6: "Manual disbursement queue
 * in Super Admin," "Partial disbursement," "Payout duplicate protection").
 *
 * All reads use the RLS-bound client — `vendor_payables_select_scoped` and
 * `disbursements_select_scoped` both grant `is_super_admin()` full
 * visibility, so a super admin sees every restaurant's ledger without the
 * service-role client. Only signed proof URLs use the service-role client
 * (private bucket read). The outstanding-per-restaurant figures here are
 * what the disbursement form guards against over-paying: the amount a super
 * admin can disburse without an audited override is capped at
 * `outstandingPaise` (see lib/actions/admin/disburse.ts).
 */

export type PayoutQueueRow = {
  restaurantId: string;
  restaurantName: string;
  netPayablePaise: number;
  disbursedPaise: number;
  outstandingPaise: number;
  oldestUnpaidAt: string | null;
  paidOrderCount: number;
};

type QueueJoinRow = {
  restaurant_id: string;
  amount_paise: number;
  disbursed_amount_paise: number;
  created_at: string;
  restaurants: { name: string } | null;
};

/**
 * The disbursement queue: one row per restaurant that has EVER had a
 * payable, with its live outstanding balance. Restaurants with nothing
 * outstanding are still returned (outstandingPaise = 0) so the queue
 * doubles as a "fully settled" view; the page sorts unpaid-first.
 */
export async function listPayoutQueue(): Promise<PayoutQueueRow[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("vendor_payables")
    .select("restaurant_id, amount_paise, disbursed_amount_paise, created_at, restaurants(name)")
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  const byRestaurant = new Map<string, PayoutQueueRow>();

  for (const row of data as unknown as QueueJoinRow[]) {
    const existing = byRestaurant.get(row.restaurant_id);
    const outstanding = row.amount_paise - row.disbursed_amount_paise;

    if (!existing) {
      byRestaurant.set(row.restaurant_id, {
        restaurantId: row.restaurant_id,
        restaurantName: row.restaurants?.name ?? "Unknown restaurant",
        netPayablePaise: row.amount_paise,
        disbursedPaise: row.disbursed_amount_paise,
        outstandingPaise: outstanding,
        // Rows arrive oldest-first; the first outstanding row we see for a
        // restaurant is its oldest unpaid order — the aging signal.
        oldestUnpaidAt: outstanding > 0 ? row.created_at : null,
        paidOrderCount: 1,
      });
    } else {
      existing.netPayablePaise += row.amount_paise;
      existing.disbursedPaise += row.disbursed_amount_paise;
      existing.outstandingPaise += outstanding;
      existing.paidOrderCount += 1;
      if (existing.oldestUnpaidAt === null && outstanding > 0) {
        existing.oldestUnpaidAt = row.created_at;
      }
    }
  }

  return Array.from(byRestaurant.values()).sort(
    (a, b) => b.outstandingPaise - a.outstandingPaise
  );
}

export type OutstandingPayableRow = {
  payableId: string;
  orderId: string;
  createdAt: string;
  amountPaise: number;
  disbursedPaise: number;
  outstandingPaise: number;
};

export type AdminDisbursementRow = {
  id: string;
  amountPaise: number;
  status: Enums<"disbursement_status">;
  reference: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  coversOrderCount: number;
  proofUrl: string | null;
  escalatedTicketId: string | null;
};

export type RestaurantPayoutDetail = {
  restaurantId: string;
  restaurantName: string;
  netPayablePaise: number;
  disbursedPaise: number;
  outstandingPaise: number;
  outstandingRows: OutstandingPayableRow[];
  disbursements: AdminDisbursementRow[];
};

export async function getRestaurantPayoutDetail(
  restaurantId: string
): Promise<RestaurantPayoutDetail | null> {
  const supabase = createServerSupabaseClient();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id, name")
    .eq("id", restaurantId)
    .maybeSingle();

  if (!restaurant) return null;

  const { data: payables } = await supabase
    .from("vendor_payables")
    .select("id, order_id, amount_paise, disbursed_amount_paise, created_at")
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: true });

  let netPayablePaise = 0;
  let disbursedPaise = 0;
  const outstandingRows: OutstandingPayableRow[] = [];

  for (const p of payables ?? []) {
    netPayablePaise += p.amount_paise;
    disbursedPaise += p.disbursed_amount_paise;
    const outstanding = p.amount_paise - p.disbursed_amount_paise;
    if (outstanding > 0) {
      outstandingRows.push({
        payableId: p.id,
        orderId: p.order_id,
        createdAt: p.created_at,
        amountPaise: p.amount_paise,
        disbursedPaise: p.disbursed_amount_paise,
        outstandingPaise: outstanding,
      });
    }
  }

  const { data: disbursementData } = await supabase
    .from("disbursements")
    .select("id, amount_paise, status, reference, created_at, acknowledged_at, covers, proof_path, not_received_escalated_ticket_id")
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false });

  const service = createServiceRoleSupabaseClient();
  const disbursements: AdminDisbursementRow[] = [];

  for (const d of disbursementData ?? []) {
    let proofUrl: string | null = null;
    if (d.proof_path) {
      const { data: signed } = await service.storage
        .from(STORAGE_BUCKETS.payoutProofs)
        .createSignedUrl(d.proof_path, 300);
      proofUrl = signed?.signedUrl ?? null;
    }
    const covers = Array.isArray(d.covers) ? (d.covers as unknown[]) : [];
    disbursements.push({
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

  return {
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    netPayablePaise,
    disbursedPaise,
    outstandingPaise: netPayablePaise - disbursedPaise,
    outstandingRows,
    disbursements,
  };
}
