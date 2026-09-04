import { cn } from "@/lib/cn";
import { fmtCount } from "@/lib/admin/format";

/**
 * Two chart primitives shared by every Phase 9 analytics page.
 *
 * Same reasoning as components/admin/trend-bars.tsx (the Phase 7 dashboard's
 * GMV chart): no charting dependency, every value duplicated as real table
 * markup so a screen reader gets numbers and the page stays reconcilable
 * against source data (SRS §14) rather than being read off a bar by eye.
 * `TrendBars` itself stays as-is (it is GMV-specific and already shipped on
 * the dashboard); these two are the count-based generalisation Phase 9 needs
 * for everything that isn't money — pickup-demand-by-hour, ticket volume,
 * order-count-per-customer.
 */

/** A vertical bar per bucket, for a series with a natural left-to-right order
 *  (hour of day, day of week, a date range). */
export function BarChart({
  data,
  className,
}: {
  data: { label: string; count: number }[];
  className?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className={cn("", className)}>
      <div className="flex items-end gap-1" role="presentation">
        {data.map((d, i) => {
          const pct = d.count === 0 ? 0 : Math.max(2, Math.round((d.count / max) * 100));
          return (
            <div key={`${d.label}-${i}`} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-20 w-full items-end rounded-sm bg-cream-200">
                <div
                  className="w-full rounded-sm bg-orange-500"
                  style={{ height: `${pct}%` }}
                  aria-hidden="true"
                />
              </div>
              <span className="text-[10px] tabular-nums text-ink-muted">{d.label}</span>
            </div>
          );
        })}
      </div>

      <table className="sr-only">
        <caption>Bucketed counts</caption>
        <thead>
          <tr>
            <th scope="col">Bucket</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={`${d.label}-${i}-row`}>
              <td>{d.label}</td>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-2 text-xs text-ink-muted">{fmtCount(total)} total.</p>
    </div>
  );
}

/** A horizontal ranked list — top categories, top restaurants, priority mix.
 *  Order is the data's meaning here, not time, so bars run left-to-right by
 *  rank rather than standing side by side. */
export function RankedBars({
  data,
  className,
  renderLabel,
}: {
  data: { label: string; count: number; href?: string }[];
  className?: string;
  /** Override the plain-text label, e.g. to render a Link. */
  renderLabel?: (item: { label: string; count: number; href?: string }) => React.ReactNode;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));

  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {data.map((d, i) => {
        const pct = d.count === 0 ? 0 : Math.max(2, Math.round((d.count / max) * 100));
        return (
          <li key={`${d.label}-${i}`}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate font-medium text-ink">
                {renderLabel ? renderLabel(d) : d.label}
              </span>
              <span className="shrink-0 tabular-nums text-ink-muted">{fmtCount(d.count)}</span>
            </div>
            <div className="mt-1 h-1.5 w-full rounded-full bg-cream-200">
              <div
                className="h-1.5 rounded-full bg-orange-500"
                style={{ width: `${pct}%` }}
                aria-hidden="true"
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
