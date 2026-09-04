import Link from "next/link";
import { requireRole } from "@/lib/auth/guards";
import { listPayoutQueue } from "@/lib/data/admin-payments";
import { paiseToRupeesDisplay } from "@/lib/money";
import { Card } from "@/components/ui/card";

/**
 * Super Admin manual disbursement queue (SRS Phase 6: "Manual disbursement
 * queue in Super Admin"). One row per restaurant, sorted by outstanding
 * payable so what's owed rises to the top. Click through to disburse.
 *
 * Reconciliation (SRS V2 §T) lives at /admin/payments/reconciliation, a
 * sibling of this page rather than a new top-level sidebar destination —
 * the admin layout's own doc comment already places it "under Payments".
 */

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium" });
}

export default async function AdminPaymentsPage() {
  await requireRole("super_admin");
  const queue = await listPayoutQueue();

  const totalOutstanding = queue.reduce((s, r) => s + r.outstandingPaise, 0);
  const owed = queue.filter((r) => r.outstandingPaise > 0);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold">Payments</h1>
        <Link
          href="/admin/payments/reconciliation"
          className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm font-semibold text-ink hover:bg-cream-200"
        >
          Reconciliation
        </Link>
      </div>
      <p className="mt-2 text-sm text-ink-soft">
        {owed.length} restaurant{owed.length === 1 ? "" : "s"} awaiting disbursement ·{" "}
        {paiseToRupeesDisplay(totalOutstanding)} outstanding platform-wide.
      </p>

      {queue.length === 0 ? (
        <p className="mt-6 text-sm text-ink-soft">No vendor payables yet.</p>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {queue.map((r) => (
            <Link key={r.restaurantId} href={`/admin/payments/${r.restaurantId}`}>
              <Card className="flex items-center justify-between hover:border-orange-400">
                <div>
                  <p className="font-semibold text-ink">{r.restaurantName}</p>
                  <p className="text-xs text-ink-soft">
                    {r.paidOrderCount} paid order{r.paidOrderCount === 1 ? "" : "s"}
                    {r.oldestUnpaidAt ? ` · oldest unpaid ${fmtDate(r.oldestUnpaidAt)}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={`font-bold ${r.outstandingPaise > 0 ? "text-ink" : "text-ink-soft"}`}
                  >
                    {paiseToRupeesDisplay(r.outstandingPaise)}
                  </p>
                  <p className="text-xs text-ink-soft">outstanding</p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
