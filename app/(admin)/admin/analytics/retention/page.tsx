import Link from "next/link";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { getRetentionMetrics, parseRangeDays } from "@/lib/admin/analytics";
import { fmtCount } from "@/lib/admin/format";
import { SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { RankedBars } from "@/components/admin/analytics-charts";
import { AnalyticsRangeSwitcher } from "@/components/admin/analytics-range-switcher";

/**
 * Customer retention / repeat-order metrics (SRS Phase 9).
 *
 * "New" and "returning" are judged against a customer's FULL order history,
 * not just this window — a customer whose only order in the last 90 days was
 * their fourth order overall is returning, even though nothing in the last 90
 * days shows their first three. See lib/admin/analytics.ts for the query that
 * makes that true.
 */

export const dynamic = "force-dynamic";

type Query = { days?: string };

export default async function AnalyticsRetentionPage({ searchParams }: { searchParams: Query }) {
  await requireSuperAdmin();

  const days = parseRangeDays(searchParams.days);
  const data = await getRetentionMetrics(days);

  return (
    <div>
      <SectionHeading
        title="Customer retention"
        description="New vs. returning is judged against each customer's full order history, not just this window."
        actions={<AnalyticsRangeSwitcher current={days} basePath="/admin/analytics/retention" />}
      />

      {data.truncated ? (
        <Card className="mb-4 border-warning bg-warning-bg">
          <p className="text-xs text-warning">
            This window has more orders than one scan covers. Figures below are a floor. Narrow to 7 days for
            an exact reconciliation.
          </p>
        </Card>
      ) : null}

      <StatGrid>
        <Stat label="Active customers" value={fmtCount(data.activeCustomerCount)} hint="Placed a realized order in this window" />
        <Stat
          label="Returning"
          value={fmtCount(data.returningCustomerCount)}
          hint={`${data.returningSharePercent}% of active customers`}
          tone="success"
        />
        <Stat label="New" value={fmtCount(data.newCustomerCount)} hint="First-ever order fell in this window" />
        <Stat
          label="Full customer list"
          value="Customers"
          hint="Segment and search by name, spend, activity"
          href="/admin/customers"
        />
      </StatGrid>

      <Card className="mt-4">
        <h2 className="font-display text-base font-semibold text-ink">Orders per active customer</h2>
        <p className="mt-0.5 text-xs text-ink-muted">
          How many realized orders each active customer placed within this window.
        </p>
        <RankedBars data={data.ordersPerCustomer.map((b) => ({ label: b.label, count: b.count }))} className="mt-4" />
      </Card>

      <p className="mt-5 text-xs text-ink-muted">
        Looking for a specific customer's history rather than a platform trend? Try the{" "}
        <Link href="/admin/customers?segment=repeat" className="underline">
          repeat-customer segment
        </Link>{" "}
        in Customers.
      </p>
    </div>
  );
}
