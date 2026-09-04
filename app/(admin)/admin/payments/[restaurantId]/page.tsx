import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";
import { getRestaurantPayoutDetail } from "@/lib/data/admin-payments";
import { paiseToRupeesDisplay } from "@/lib/money";
import { Card } from "@/components/ui/card";
import { DisburseForm } from "@/components/admin/disburse-form";

/**
 * Super Admin per-restaurant disbursement workspace (SRS Phase 6: "select
 * vendor → see available → enter amount → mark disbursed + upload proof,"
 * partial disbursement, vendor disbursement history, proof viewing). The
 * DisburseForm's over-disburse guard + oldest-first allocation live in
 * lib/actions/admin/disburse.ts.
 */

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  paid: "Sent — awaiting vendor confirmation",
  acknowledged_received: "Vendor confirmed received",
  acknowledged_not_received: "Vendor reported NOT received",
};

export default async function AdminRestaurantPayoutPage({
  params,
}: {
  params: { restaurantId: string };
}) {
  await requireRole("super_admin");
  const detail = await getRestaurantPayoutDetail(params.restaurantId);

  if (!detail) notFound();

  return (
    <div>
      <Link href="/admin/payments" className="text-sm text-orange-600 underline">
        ← Payments queue
      </Link>
      <h1 className="mt-3 text-2xl font-bold">{detail.restaurantName}</h1>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-soft">Outstanding</p>
          <p className="mt-1 text-xl font-bold text-ink">{paiseToRupeesDisplay(detail.outstandingPaise)}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-soft">Total payable</p>
          <p className="mt-1 text-xl font-bold text-ink">{paiseToRupeesDisplay(detail.netPayablePaise)}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-soft">Disbursed</p>
          <p className="mt-1 text-xl font-bold text-ink">{paiseToRupeesDisplay(detail.disbursedPaise)}</p>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold">Record a disbursement</h2>
          <div className="mt-3">
            <DisburseForm
              restaurantId={detail.restaurantId}
              outstandingRupees={paiseToRupeesDisplay(detail.outstandingPaise)}
            />
          </div>
        </Card>

        <div>
          <h2 className="text-lg font-semibold">Outstanding orders</h2>
          {detail.outstandingRows.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">Fully settled — nothing outstanding.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th className="py-2 pr-4">Order</th>
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.outstandingRows.map((o) => (
                    <tr key={o.payableId} className="border-t border-cream-300">
                      <td className="py-2 pr-4 font-mono text-xs">{o.orderId.slice(0, 8)}</td>
                      <td className="py-2 pr-4">{fmtDate(o.createdAt)}</td>
                      <td className="py-2 pr-4 font-medium">{paiseToRupeesDisplay(o.outstandingPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <h2 className="mt-8 text-lg font-semibold">Disbursement history</h2>
      {detail.disbursements.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">No disbursements recorded yet.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {detail.disbursements.map((d) => (
            <Card key={d.id} className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-ink">{paiseToRupeesDisplay(d.amountPaise)}</p>
                <p className="text-xs text-ink-soft">
                  {fmtDate(d.createdAt)} · covers {d.coversOrderCount} order{d.coversOrderCount === 1 ? "" : "s"}
                  {d.reference ? ` · ref ${d.reference}` : ""}
                </p>
                <p className="mt-1 text-xs font-medium text-ink">{STATUS_LABEL[d.status] ?? d.status}</p>
                {d.escalatedTicketId && (
                  <Link
                    href={`/admin/grievances/${d.escalatedTicketId}`}
                    className="text-xs font-semibold text-danger underline"
                  >
                    View dispute →
                  </Link>
                )}
              </div>
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
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
