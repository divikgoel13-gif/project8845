import Link from "next/link";
import { cn } from "@/lib/cn";
import { ANALYTICS_RANGE_DAYS, type AnalyticsRangeDays } from "@/lib/admin/analytics";

/**
 * The 7 / 30 / 90-day toggle shared by every analytics tab that reads a date
 * range (all but Pickup Demand, which is deliberately forward-looking and
 * fixed to 7 days — see lib/admin/analytics.ts).
 *
 * Link-based, matching components/ui/pagination.tsx: the range lives in the
 * query string, so "GMV trend, last 90 days" is a URL an operator can paste
 * into a handover message rather than client state that resets on reload.
 * `preserveParams` carries over the page's own filters (a sort column, a
 * restaurant filter) so switching range never silently drops them.
 */
export function AnalyticsRangeSwitcher({
  current,
  basePath,
  preserveParams,
  className,
}: {
  current: AnalyticsRangeDays;
  basePath: string;
  preserveParams?: Record<string, string | undefined>;
  className?: string;
}) {
  const href = (days: number) => {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries(preserveParams ?? {})) {
      if (value) sp.set(key, value);
    }
    sp.set("days", String(days));
    return `${basePath}?${sp.toString()}`;
  };

  return (
    <div className={cn("inline-flex items-center gap-1 rounded-brand border border-cream-300 bg-cream-50 p-1", className)}>
      {ANALYTICS_RANGE_DAYS.map((days) => (
        <Link
          key={days}
          href={href(days)}
          aria-current={days === current ? "page" : undefined}
          className={cn(
            "rounded-brand px-2.5 py-1 text-xs font-semibold",
            days === current ? "bg-maroon-500 text-cream-50" : "text-ink-soft hover:bg-cream-200"
          )}
        >
          {days}d
        </Link>
      ))}
    </div>
  );
}
