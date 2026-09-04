import Link from "next/link";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { getPlatformAnalytics, parseRangeDays } from "@/lib/admin/analytics";
import { paiseToRupeesDisplay } from "@/lib/money";
import { fmtCount } from "@/lib/admin/format";
import { SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { TrendBars } from "@/components/admin/trend-bars";
import { AnalyticsRangeSwitcher } from "@/components/admin/analytics-range-switcher";

/**
 * Platform GMV / order / AOV analytics (SRS Phase 9), the landing page of
 * Global Analytics.
 *
 * GMV here means the same thing it means on the Phase 7 dashboard's "today"
 * tile: realized sales value, `REALIZED_SALE_STATUSES` only. The dashboard
 * answers "how is today going"; this page answers "how is the selected
 * window going, and is it reconcilable" — a deliberately different question,
 * not a duplicate one.
 */

export const dynamic = "force-dynamic";

type Query = { days?: string };

export default async function AnalyticsOverviewPage({ searchParams }: { searchParams: Query }) {
  await requireSuperAdmin();

  const days = parseRangeDays(searchParams.days);
  const data = await getPlatformAnalytics(days);

  return (
    <div>
      <SectionHeading
        title={`Last ${days} days`}
        description="Realized sales only — orders that reached at least 'paid'. Cancelled, refunded and no-show orders are tracked separately below, never netted out of GMV."
        actions={<AnalyticsRangeSwitcher current={days} basePath="/admin/analytics" />}
      />

      {data.truncated ? (
        <Card className="mb-4 border-warning bg-warning-bg">
          <p className="text-xs text-warning">
            This window has more orders than a single scan covers. Figures below are a floor, not an exact
            total — narrow to 7 days for an exact reconciliation.
          </p>
        </Card>
      ) : null}

      <StatGrid>
        <Stat label="GMV" value={paiseToRupeesDisplay(data.totals.gmvPaise)} hint={`${fmtCount(data.totals.orderCount)} orders`} />
        <Stat label="Average order value" value={paiseToRupeesDisplay(data.totals.aovPaise)} />
        <Stat
          label="Commission earned"
          value={paiseToRupeesDisplay(data.totals.commissionPaise)}
          hint="From orders' own snapshots, not today's rate"
        />
        <Stat
          label="Collection rate"
          value={`${data.totals.collectionRatePercent}%`}
          hint={`${fmtCount(data.totals.collectedCount)} collected of ${fmtCount(data.totals.orderCount)}`}
          tone={data.totals.collectionRatePercent >= 90 ? "success" : "default"}
        />
      </StatGrid>

      <StatGrid className="mt-3">
        <Stat label="Cancelled" value={fmtCount(data.totals.cancelledCount)} tone={data.totals.cancelledCount > 0 ? "warning" : "default"} />
        <Stat label="No-shows" value={fmtCount(data.totals.noShowCount)} tone={data.totals.noShowCount > 0 ? "warning" : "default"} />
        <Stat label="Active restaurants" value={`${data.restaurantCount.active} / ${data.restaurantCount.total}`} href="/admin/restaurants" />
        <Stat label="Registered customers" value={fmtCount(data.customerCount)} href="/admin/customers" />
      </StatGrid>

      <Card className="mt-4">
        <h2 className="font-display text-base font-semibold text-ink">GMV trend</h2>
        <p className="mt-0.5 text-xs text-ink-muted">Bucketed by campus calendar day, oldest first.</p>
        <TrendBars data={data.trend} className="mt-4" />
      </Card>

      <p className="mt-5 text-xs text-ink-muted">
        Want more depth? See{" "}
        <Link href="/admin/analytics/restaurants" className="underline">
          Restaurants
        </Link>
        ,{" "}
        <Link href="/admin/analytics/retention" className="underline">
          Retention
        </Link>
        ,{" "}
        <Link href="/admin/analytics/products" className="underline">
          Products
        </Link>{" "}
        and{" "}
        <Link href="/admin/analytics/grievances" className="underline">
          Grievances
        </Link>
        .
      </p>
    </div>
  );
}
