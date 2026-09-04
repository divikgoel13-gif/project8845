import { requireRole } from "@/lib/auth/guards";
import { getMyRestaurants } from "@/lib/data/my-restaurants";
import {
  getVendorPayableSummary,
  listVendorPayableOrders,
  listVendorDisbursements,
} from "@/lib/data/vendor-payments";
import { paiseToRupeesDisplay } from "@/lib/money";
import { Card } from "@/components/ui/card";
import { RestaurantSwitcher } from "@/components/vendor/restaurant-switcher";
import { PayoutAckActions } from "@/components/vendor/payout-ack-actions";

/**
 * Vendor Payments page (SRS Phase 6: "Vendor Payments page," "Outstanding
 * payable view," "Per-order financial breakdown," "Vendor disbursement
 * history," "Vendor proof viewing," "Received / Not Received
 * acknowledgement"). All figures come from the vendor_payables ledger, so
 * they reconcile with paid orders + snapshotted commission by construction
 * (see lib/data/vendor-payments.ts).
 */

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

const DISBURSEMENT_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  paid: "Sent — awaiting your confirmation",
  acknowledged_received: "Received",
  acknowledged_not_received: "Reported not received",
};

export default async function VendorPaymentsPage({
  searchParams,
}: {
  searchParams: { restaurant?: string };
}) {
  const profile = await requireRole("vendor_admin");
  const restaurants = await getMyRestaurants(profile);

  if (restaurants.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Payments</h1>
        <p className="mt-4 text-ink-soft">You aren't currently assigned to a restaurant.</p>
      </div>
    );
  }

  const selected = restaurants.find((r) => r.id === searchParams.restaurant)
    // restaurants is guaranteed non-empty by the length check above,
    // so restaurants[0] is a safe fallback.
    ?? restaurants[0]!;
  const [summary, orders, disbursements] = await Promise.all([
    getVendorPayableSummary(selected.id),
    listVendorPayableOrders(selected.id),
    listVendorDisbursements(selected.id),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold">Payments</h1>

      {restaurants.length > 1 && (
        <RestaurantSwitcher restaurants={restaurants} selectedId={selected.id} basePath="/vendor/payments" />
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-soft">Outstanding</p>
          <p className="mt-1 text-xl font-bold text-ink">{paiseToRupeesDisplay(summary.outstandingPaise)}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-soft">Total payable</p>
          <p className="mt-1 text-xl font-bold text-ink">{paiseToRupeesDisplay(summary.netPayablePaise)}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-soft">Disbursed</p>
          <p className="mt-1 text-xl font-bold text-ink">{paiseToRupeesDisplay(summary.disbursedPaise)}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-soft">Paid orders</p>
          <p className="mt-1 text-xl font-bold text-ink">{summary.paidOrderCount}</p>
        </Card>
      </div>

      <p className="mt-2 text-xs text-ink-soft">
        Gross sales {paiseToRupeesDisplay(summary.grossSalesPaise)} − UNI8 commission{" "}
        {paiseToRupeesDisplay(summary.commissionPaise)} = {paiseToRupeesDisplay(summary.netPayablePaise)} payable.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Disbursement history</h2>
      {disbursements.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">No disbursements yet.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {disbursements.map((d) => (
            <Card key={d.id} className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-semibold text-ink">{paiseToRupeesDisplay(d.amountPaise)}</p>
                <p className="text-xs text-ink-soft">
                  {fmtDate(d.createdAt)} · covers {d.coversOrderCount} order{d.coversOrderCount === 1 ? "" : "s"}
                  {d.reference ? ` · ref ${d.reference}` : ""}
                </p>
                <p className="mt-1 text-xs font-medium text-ink">
                  {DISBURSEMENT_STATUS_LABEL[d.status] ?? d.status}
                  {d.acknowledgedAt ? ` · ${fmtDate(d.acknowledgedAt)}` : ""}
                </p>
              </div>
              <div className="flex flex-col items-start gap-2 md:items-end">
                {d.proofUrl ? (
                  <a
                    href={d.proofUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold text-orange-600 underline"
                  >
                    View proof
                  </a>
                ) : (
                  <span className="text-xs text-ink-soft">Proof unavailable</span>
                )}
                {d.status === "paid" && (
                  <PayoutAckActions restaurantId={selected.id} disbursementId={d.id} />
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold">Per-order breakdown</h2>
      {orders.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">No paid orders yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="py-2 pr-4">Order</th>
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Gross</th>
                <th className="py-2 pr-4">Commission</th>
                <th className="py-2 pr-4">Payable</th>
                <th className="py-2 pr-4">Disbursed</th>
                <th className="py-2 pr-4">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.orderId} className="border-t border-cream-300">
                  <td className="py-2 pr-4 font-mono text-xs">{o.orderId.slice(0, 8)}</td>
                  <td className="py-2 pr-4">{fmtDate(o.createdAt)}</td>
                  <td className="py-2 pr-4">{paiseToRupeesDisplay(o.grossPaise)}</td>
                  <td className="py-2 pr-4">
                    {paiseToRupeesDisplay(o.commissionPaise)}
                    {o.commissionRateSnapshot !== null ? (
                      <span className="text-ink-soft"> ({Math.round(o.commissionRateSnapshot * 100)}%)</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4">{paiseToRupeesDisplay(o.payablePaise)}</td>
                  <td className="py-2 pr-4">{paiseToRupeesDisplay(o.disbursedPaise)}</td>
                  <td className="py-2 pr-4 font-medium">{paiseToRupeesDisplay(o.outstandingPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
