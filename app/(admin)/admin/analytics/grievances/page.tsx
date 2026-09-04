import Link from "next/link";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { getGrievancePerformance, parseRangeDays } from "@/lib/admin/analytics";
import { fmtCount } from "@/lib/admin/format";
import { SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { BarChart, RankedBars } from "@/components/admin/analytics-charts";
import { AnalyticsRangeSwitcher } from "@/components/admin/analytics-range-switcher";

/**
 * Grievance performance analytics (SRS §13, Phase 9).
 *
 * SLA attainment reuses lib/grievance/sla.ts's own evaluateSla — the exact
 * function the ticket detail page uses to decide whether one ticket is
 * breached — rather than re-deriving the rule here. If a ticket disagrees
 * with the platform-wide percentage, that is a bug in one shared function,
 * not two definitions to reconcile.
 */

export const dynamic = "force-dynamic";

type Query = { days?: string };

export default async function AnalyticsGrievancesPage({ searchParams }: { searchParams: Query }) {
  await requireSuperAdmin();

  const days = parseRangeDays(searchParams.days);
  const data = await getGrievancePerformance(days);
  const { totals } = data;

  return (
    <div>
      <SectionHeading
        title="Grievance performance"
        description="Tickets created in this window. SLA attainment and CSAT reuse the same evaluator the ticket detail page uses."
        actions={<AnalyticsRangeSwitcher current={days} basePath="/admin/analytics/grievances" />}
      />

      {data.truncated ? (
        <Card className="mb-4 border-warning bg-warning-bg">
          <p className="text-xs text-warning">
            More tickets exist in this window than one scan covers. Figures below are a floor. Narrow to 7
            days for an exact reconciliation.
          </p>
        </Card>
      ) : null}

      <StatGrid>
        <Stat label="Tickets created" value={fmtCount(totals.created)} />
        <Stat
          label="Still open"
          value={fmtCount(totals.stillOpen)}
          tone={totals.stillOpen > 0 ? "warning" : "default"}
          href="/admin/grievances?view=waiting_on_us"
        />
        <Stat
          label="Breached and still open"
          value={fmtCount(totals.breachedOpenCount)}
          tone={totals.breachedOpenCount > 0 ? "danger" : "default"}
          href="/admin/grievances?view=waiting_on_us"
        />
        <Stat label="Resolved / closed" value={`${fmtCount(totals.resolved)} / ${fmtCount(totals.closed)}`} />
      </StatGrid>

      <StatGrid className="mt-3">
        <Stat
          label="First response met"
          value={totals.firstResponseMetPercent !== null ? `${totals.firstResponseMetPercent}%` : "—"}
          hint={totals.firstResponseMetPercent === null ? "No tickets with a due first response yet" : "Of tickets with a due date"}
          tone={totals.firstResponseMetPercent !== null && totals.firstResponseMetPercent < 80 ? "warning" : "default"}
        />
        <Stat
          label="Resolution met"
          value={totals.resolutionMetPercent !== null ? `${totals.resolutionMetPercent}%` : "—"}
          hint={totals.resolutionMetPercent === null ? "No tickets judged on resolution yet" : "Of tickets judged on resolution"}
          tone={totals.resolutionMetPercent !== null && totals.resolutionMetPercent < 80 ? "warning" : "default"}
        />
        <Stat
          label="Avg. resolution time"
          value={totals.avgResolutionMinutes !== null ? formatMinutes(totals.avgResolutionMinutes) : "—"}
          hint="From ticket creation to resolved"
        />
        <Stat
          label="Avg. CSAT"
          value={totals.avgCsat !== null ? `${totals.avgCsat.toFixed(1)} / 5` : "—"}
          hint={`${fmtCount(totals.csatResponses)} responses`}
        />
      </StatGrid>

      <Card className="mt-4">
        <h2 className="font-display text-base font-semibold text-ink">Tickets created, by day</h2>
        <BarChart data={data.trend.map((t) => ({ label: t.date.slice(8), count: t.count }))} className="mt-4" />
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-display text-base font-semibold text-ink">By category</h2>
          {data.byCategory.length === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">No tickets in this window.</p>
          ) : (
            <RankedBars className="mt-4" data={data.byCategory.map((c) => ({ label: c.category.replace(/_/g, " "), count: c.count }))} />
          )}
        </Card>
        <Card>
          <h2 className="font-display text-base font-semibold text-ink">By priority</h2>
          {data.byPriority.length === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">No tickets in this window.</p>
          ) : (
            <RankedBars className="mt-4" data={data.byPriority.map((p) => ({ label: p.priority, count: p.count }))} />
          )}
        </Card>
      </div>

      <p className="mt-5 text-xs text-ink-muted">
        Need to act on a specific ticket rather than the trend? Go to the{" "}
        <Link href="/admin/grievances" className="underline">
          grievance queue
        </Link>
        .
      </p>
    </div>
  );
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}
