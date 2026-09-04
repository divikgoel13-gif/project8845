import Link from "next/link";
import { requireRole } from "@/lib/auth/guards";
import { getGlobalDashboard } from "@/lib/admin/dashboard";
import { getLiveOperations } from "@/lib/admin/live-ops";
import { Card } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { Badge, severityTone } from "@/components/ui/badge";
import { TrendBars } from "@/components/admin/trend-bars";
import { paiseToRupeesDisplay } from "@/lib/money";
import { fmtCount, fmtRate, fmtDateTime, TIMEZONE_NOTE } from "@/lib/admin/format";

/**
 * Global Super Admin Dashboard (SRS §6, Phase 7 deliverable).
 *
 * Structured as five bands, in the order an operator actually triages: what is
 * happening right now, what today has produced, the money position, the support
 * backlog, then the fourteen-day shape. Financial figures come from the
 * per-order snapshot columns, so the commission tile is labelled as the CURRENT
 * SETTING rather than sitting next to today's commission total as though one
 * derived the other (SRS §23 — changing the rate never rewrites history).
 *
 * §F is a separate page (/admin/operations), not folded in here: §F says the
 * command center "is additive to the original Super Admin Dashboard and
 * Analytics; neither is removed". What appears here is the top-of-funnel — the
 * actionable alert count and the worst few groups — with everything else one
 * click away.
 *
 * `revalidate = 30` rather than a client poller. §F.1 permits "periodic
 * refresh/server aggregation" instead of Realtime, and a 30-second server cache
 * gives every operator the same numbers while a per-client interval would have
 * each of them looking at a slightly different platform.
 */
export const revalidate = 30;

export default async function AdminDashboardPage() {
  await requireRole("super_admin");
  const now = new Date();
  const [dash, live] = await Promise.all([getGlobalDashboard(now), getLiveOperations(now)]);

  const pressing = live.groups
    .filter((g) => g.severity !== "info" && g.count - g.ackedCount > 0)
    .sort((a, b) => b.count - b.ackedCount - (a.count - a.ackedCount));

  // The campus date the "today" band is reporting on. Taken from the last trend
  // bucket rather than formatted from `now` again, so the heading can never name
  // a different day from the series underneath it.
  const todayIsoDate = dash.gmvTrend[dash.gmvTrend.length - 1]?.date ?? "";

  return (
    <div>
      <PageHeader
        title="Command Center"
        description={`Platform-wide position for ${todayIsoDate}, a campus day rather than a UTC one — figures roll over at midnight campus time, so the 06:00 breakfast rush belongs to the day it happened. ${TIMEZONE_NOTE}.`}
        actions={
          <Link
            href="/admin/operations"
            className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm font-semibold text-ink hover:bg-cream-200"
          >
            Live Operations
          </Link>
        }
      />

      {/* ── band 1: right now ──────────────────────────────────────────── */}
      <SectionHeading
        title="Right now"
        description="Not day-bounded. In-flight means paid and not yet collected — money already taken for food still owed to a customer."
      />
      <StatGrid>
        <Stat
          label="Needs attention"
          value={fmtCount(live.actionableCount)}
          hint="Unacknowledged operational alerts"
          href="/admin/operations"
          tone={live.actionableCount > 0 ? "danger" : "success"}
        />
        <Stat
          label="Orders in flight"
          value={fmtCount(dash.now.inFlightCount)}
          hint={`${paiseToRupeesDisplay(dash.now.inFlightValuePaise)} of outstanding obligation`}
          href="/admin/orders?status=paid&status=scheduled&status=preparing&status=ready_for_pickup"
        />
        <Stat
          label="Pickups next hour"
          value={fmtCount(dash.now.pickupsNextHour)}
          hint="Workload arriving at the counters"
          href="/admin/operations"
        />
        <Stat
          label="Overdue pickups"
          value={fmtCount(dash.now.overduePickups)}
          hint="Past pickup time, not collected"
          href="/admin/operations"
          tone={dash.now.overduePickups > 0 ? "danger" : "default"}
        />
      </StatGrid>

      {pressing.length > 0 ? (
        <Card className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Loudest alert groups
          </p>
          <ul className="mt-2 divide-y divide-cream-200">
            {pressing.slice(0, 5).map((g) => (
              <li key={g.type} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href="/admin/operations" className="text-sm font-semibold text-ink hover:underline">
                  {g.label}
                </Link>
                <span className="flex items-center gap-2">
                  {g.ackedCount > 0 ? (
                    <span className="text-xs text-ink-muted">{g.ackedCount} acknowledged</span>
                  ) : null}
                  <Badge tone={severityTone(g.severity)}>{g.count - g.ackedCount} open</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ── band 2: today ─────────────────────────────────────────────── */}
      <SectionHeading
        className="mt-8"
        title="Today"
        description="GMV is the value of realised sales — every order from payment onward, including collected. Cancelled, refunded and no-show orders are reported separately, never netted off GMV."
      />
      <StatGrid>
        <Stat
          label="GMV today"
          value={paiseToRupeesDisplay(dash.today.gmvPaise)}
          hint={`${fmtCount(dash.today.orderCount)} realised orders`}
          href="/admin/analytics"
        />
        <Stat
          label="Average order value"
          value={paiseToRupeesDisplay(dash.today.aovPaise)}
          hint="GMV divided by realised orders"
        />
        <Stat
          label="Commission earned today"
          value={paiseToRupeesDisplay(dash.today.commissionPaise)}
          hint="Summed from each order's own snapshot, not recomputed"
        />
        <Stat
          label="Vendor payable today"
          value={paiseToRupeesDisplay(dash.today.vendorPayablePaise)}
          hint="What today's sales owe the restaurants"
        />
      </StatGrid>
      <StatGrid className="mt-3">
        <Stat
          label="Collected"
          value={fmtCount(dash.today.collectedCount)}
          hint="Handed over to the customer"
          tone="success"
        />
        <Stat
          label="Cancelled"
          value={fmtCount(dash.today.cancelledCount)}
          hint="Customer or restaurant cancellation"
          tone={dash.today.cancelledCount > 0 ? "warning" : "default"}
        />
        <Stat
          label="No-shows"
          value={fmtCount(dash.today.noShowCount)}
          hint="Never collected within the grace period"
          tone={dash.today.noShowCount > 0 ? "warning" : "default"}
        />
        <Stat
          label="New customers"
          value={fmtCount(dash.platform.newCustomersToday)}
          hint={`${fmtCount(dash.platform.customers)} customers in total`}
          href="/admin/customers"
        />
      </StatGrid>

      {/* ── band 3: money ─────────────────────────────────────────────── */}
      <SectionHeading
        className="mt-8"
        title="Money position"
        description="Lifetime figures. Outstanding payable is what has been earned by restaurants and not yet disbursed; it is not a today number."
      />
      <StatGrid>
        <Stat
          label="Outstanding vendor payable"
          value={paiseToRupeesDisplay(dash.finance.outstandingPayablePaise)}
          hint="Earned, not yet disbursed"
          href="/admin/payments"
        />
        <Stat
          label="Payouts awaiting acknowledgement"
          value={fmtCount(dash.finance.payoutsAwaitingAck)}
          hint="Sent by UNI8, unconfirmed by the vendor"
          href="/admin/payments"
          tone={dash.finance.payoutsAwaitingAck > 0 ? "warning" : "default"}
        />
        <Stat
          label="Commission rate (current setting)"
          value={fmtRate(dash.finance.commissionRate)}
          hint="Configuration. Changing it never alters past orders."
          href="/admin/settings"
        />
        <Stat
          label="Restaurants live"
          value={fmtCount(dash.platform.activeRestaurants)}
          hint={`${fmtCount(dash.platform.pausedRestaurants)} paused · ${fmtCount(dash.platform.closedRestaurants)} closed · ${fmtCount(dash.platform.archivedRestaurants)} archived`}
          href="/admin/restaurants"
        />
      </StatGrid>

      {/* ── band 4: support ───────────────────────────────────────────── */}
      <SectionHeading
        className="mt-8"
        title="Support and integrity"
        description="Open means any status other than resolved or closed. Unassigned tickets have no owner and therefore no one watching their SLA clock."
      />
      <StatGrid>
        <Stat
          label="Open grievances"
          value={fmtCount(dash.support.openTickets)}
          href="/admin/grievances"
        />
        <Stat
          label="Urgent or high"
          value={fmtCount(dash.support.urgentOrHighOpen)}
          href="/admin/grievances?priority=urgent&priority=high"
          tone={dash.support.urgentOrHighOpen > 0 ? "danger" : "default"}
        />
        <Stat
          label="Unassigned"
          value={fmtCount(dash.support.unassignedOpen)}
          hint="No owner yet"
          href="/admin/grievances?assignee=unassigned"
          tone={dash.support.unassignedOpen > 0 ? "warning" : "default"}
        />
        <Stat
          label="Open fraud flags"
          value={fmtCount(dash.support.openFraudFlags)}
          hint="Recorded, never auto-actioned"
          href="/admin/audit/fraud"
          tone={dash.support.openFraudFlags > 0 ? "warning" : "default"}
        />
      </StatGrid>

      {/* ── band 5: trend ─────────────────────────────────────────────── */}
      <Card className="mt-8">
        <SectionHeading
          title="GMV, last 14 campus days"
          description="Bucketed by the campus date each order was placed. Realised sales only, so the series reconciles with the GMV tile above."
        />
        <TrendBars data={dash.gmvTrend} />
      </Card>

      <p className="mt-6 text-xs text-ink-muted">
        Aggregated {fmtDateTime(live.generatedAt)}. Refreshes on load, at most every 30 seconds.
      </p>
    </div>
  );
}
