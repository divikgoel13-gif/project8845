import { cn } from "@/lib/cn";
import { paiseToRupeesDisplay } from "@/lib/money";
import { fmtCount } from "@/lib/admin/format";

/**
 * A 14-day GMV bar chart, drawn in plain CSS.
 *
 * No charting library: the project has no chart dependency, adding one for a
 * single fourteen-bar series would be the largest bundle addition in the admin
 * console, and §27 makes every dashboard phone-first — a canvas chart is the
 * part of a dashboard that behaves worst on a 360px screen.
 *
 * The bars are heights only. Every value is ALSO exposed as text in the
 * accompanying table markup below, because a chart with no readable numbers is
 * useless to a screen reader and useless for reconciliation against the
 * analytics page (§14 "reconcile with source data").
 */
export function TrendBars({
  data,
  className,
}: {
  data: { date: string; gmvPaise: number; orderCount: number }[];
  className?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.gmvPaise));
  const total = data.reduce((sum, d) => sum + d.gmvPaise, 0);
  const orders = data.reduce((sum, d) => sum + d.orderCount, 0);

  return (
    <div className={cn("", className)}>
      <div className="flex items-end gap-1" role="presentation">
        {data.map((d) => {
          // Floor of 2% so a day with a single small order is still visibly
          // distinct from a day with none — an invisible bar reads as missing
          // data rather than as a quiet day.
          const pct = d.gmvPaise === 0 ? 0 : Math.max(2, Math.round((d.gmvPaise / max) * 100));
          return (
            <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-24 w-full items-end rounded-sm bg-cream-200">
                <div
                  className="w-full rounded-sm bg-orange-500"
                  style={{ height: `${pct}%` }}
                  aria-hidden="true"
                />
              </div>
              <span className="text-[10px] tabular-nums text-ink-muted">{d.date.slice(8)}</span>
            </div>
          );
        })}
      </div>

      <table className="mt-3 w-full text-xs">
        <caption className="sr-only">
          Gross merchandise value and order count for each of the last 14 campus days
        </caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Date</th>
            <th scope="col">GMV</th>
            <th scope="col">Orders</th>
          </tr>
        </thead>
        <tbody className="sr-only">
          {data.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{paiseToRupeesDisplay(d.gmvPaise)}</td>
              <td>{d.orderCount}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="text-ink-muted">
            <td className="pt-1">14-day total</td>
            <td className="pt-1 text-right font-semibold tabular-nums text-ink">
              {paiseToRupeesDisplay(total)}
            </td>
            <td className="pt-1 text-right tabular-nums">{fmtCount(orders)} orders</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
