import Link from "next/link";
import { requireRole } from "@/lib/auth/guards";
import { getLiveOperations, type LiveAlertGroup } from "@/lib/admin/live-ops";
import { listAllAnnouncements, announcementState } from "@/lib/platform/announcements";
import { listRestaurantOptions } from "@/lib/admin/restaurants";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Badge, severityTone } from "@/components/ui/badge";
import { AlertAckButton } from "@/components/admin/alert-ack-button";
import { AnnouncementsManager, type AnnouncementListItem } from "@/components/admin/announcement-form";
import { fmtCount, fmtDateTime, fmtRelative, TIMEZONE_NOTE } from "@/lib/admin/format";

/**
 * Super Admin Live Operations Command Center (SRS V2 §F).
 *
 * All eleven §F alert classes on one page, ordered by severity rather than by
 * the SRS's listing order. §F is a checklist of what must exist; the order an
 * operator needs is worst-first, and a page that led with "due for pickup soon"
 * would bury the orders that are already late underneath the ones that are fine.
 *
 * Acknowledged alerts stay in the list, dimmed, with who acknowledged them. §F.1
 * asks for acknowledgement to be auditable, not for it to hide the problem — an
 * acknowledged overdue pickup is still an overdue pickup, and filtering it out
 * would let "seen" pass for "handled" during exactly the shift handover this
 * page exists to support.
 *
 * `revalidate = 15`, tighter than the dashboard's 30: this is the page someone
 * leaves open during a rush. §F.1 explicitly permits "periodic refresh/server
 * aggregation" instead of Realtime, and server revalidation keeps every operator
 * on the same snapshot — a per-client poller would have two people reading
 * different counts and each assuming the other was wrong.
 */
export const revalidate = 15;

export default async function LiveOperationsPage() {
  await requireRole("super_admin");
  const [live, announcements, restaurantOptions] = await Promise.all([
    getLiveOperations(),
    listAllAnnouncements(),
    listRestaurantOptions(),
  ]);

  const announcementItems: AnnouncementListItem[] = announcements.map((a) => ({
    id: a.id,
    title: a.title,
    message: a.message,
    severity: a.severity,
    scope: a.scope,
    restaurantId: a.restaurantId,
    restaurantName: a.restaurantName,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    isPublished: a.isPublished,
    archivedAt: a.archivedAt,
    state: announcementState(a),
  }));

  const critical = live.groups.filter((g) => g.severity === "critical");
  const warning = live.groups.filter((g) => g.severity === "warning");
  const info = live.groups.filter((g) => g.severity === "info");

  const openIn = (gs: LiveAlertGroup[]) => gs.reduce((sum, g) => sum + (g.count - g.ackedCount), 0);

  return (
    <div>
      <PageHeader
        title="Operations"
        description={`Live order operations and customer/vendor announcements — the platform's two always-on operational surfaces (SRS §F, §O). ${TIMEZONE_NOTE}.`}
        actions={
          <Link
            href="/admin/dashboard"
            className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm font-semibold text-ink hover:bg-cream-200"
          >
            Dashboard
          </Link>
        }
      />

      <SectionHeading
        title="Live Operations"
        description="Server-computed against a single clock, refreshed at most every 15 seconds. Acknowledging an alert records that you have seen it and does not resolve it — the fix happens on the order, restaurant or payout itself."
      />

      <StatGrid>
        <Stat
          label="Needs attention"
          value={fmtCount(live.actionableCount)}
          hint="Unacknowledged, excluding informational"
          tone={live.actionableCount > 0 ? "danger" : "success"}
        />
        <Stat
          label="Critical"
          value={fmtCount(openIn(critical))}
          hint="Money or a waiting customer is exposed"
          tone={openIn(critical) > 0 ? "danger" : "default"}
        />
        <Stat
          label="Warnings"
          value={fmtCount(openIn(warning))}
          hint="Will become critical if left"
          tone={openIn(warning) > 0 ? "warning" : "default"}
        />
        <Stat
          label="Informational"
          value={fmtCount(info.reduce((sum, g) => sum + g.count, 0))}
          hint="Workload ahead, no action required"
        />
      </StatGrid>

      <div className="mt-6 flex flex-col gap-4">
        {[...critical, ...warning, ...info].map((group) => (
          <AlertGroupCard key={group.type} group={group} />
        ))}
      </div>

      <section className="mt-8">
        <SectionHeading
          title="Announcements"
          description="Visible to customers only once explicitly published (SRS V2 §O). Create/edit/publish/unpublish/archive are each independently audited."
        />
        <div className="mt-2">
          <AnnouncementsManager announcements={announcementItems} restaurantOptions={restaurantOptions} />
        </div>
      </section>

      <p className="mt-6 text-xs text-ink-muted">
        Aggregated {fmtDateTime(live.generatedAt)}. Thresholds: pickup overdue after{" "}
        {live.thresholds.pickupOverdueMinutes}m, readiness overdue after{" "}
        {live.thresholds.readyOverdueMinutes}m, not-started window{" "}
        {live.thresholds.notStartedMinutesBeforePickup}m before pickup, due-soon window{" "}
        {live.thresholds.dueSoonMinutes}m, capacity warning at{" "}
        {Math.round(live.thresholds.capacityWarningRatio * 100)}%. Change these under{" "}
        <Link href="/admin/settings" className="underline">
          Settings
        </Link>
        .
      </p>
    </div>
  );
}

function AlertGroupCard({ group }: { group: LiveAlertGroup }) {
  const open = group.count - group.ackedCount;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold text-ink">{group.label}</h2>
          <p className="mt-0.5 max-w-2xl text-xs text-ink-muted">{group.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {group.ackedCount > 0 ? (
            <span className="text-xs text-ink-muted">{group.ackedCount} acknowledged</span>
          ) : null}
          <Badge tone={open > 0 ? severityTone(group.severity) : "success"}>
            {open > 0 ? `${open} open` : "clear"}
          </Badge>
        </div>
      </div>

      {group.items.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">Nothing in this group right now.</p>
      ) : (
        <ul className="mt-3 divide-y divide-cream-200">
          {group.items.map((alert) => (
            <li
              key={`${alert.targetTable}-${alert.targetId}`}
              className={alert.ack ? "py-2.5 opacity-60" : "py-2.5"}
            >
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                <div className="min-w-0 flex-1">
                  {/* §F.1: every alert links to the underlying record. */}
                  <Link
                    href={alert.href}
                    className="block truncate text-sm font-semibold text-ink hover:underline"
                  >
                    {alert.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-ink-soft">{alert.detail}</p>
                  {alert.ack?.note ? (
                    <p className="mt-0.5 text-xs italic text-ink-muted">Note: {alert.ack.note}</p>
                  ) : null}
                </div>
                <div className="shrink-0">
                  <AlertAckButton
                    alertType={group.type}
                    targetTable={alert.targetTable}
                    targetId={alert.targetId}
                    restaurantId={alert.restaurantId}
                    acknowledged={alert.ack !== null}
                    ackLabel={
                      alert.ack
                        ? `Acknowledged by ${alert.ack.by ?? "an admin"} ${fmtRelative(alert.ack.at)}`
                        : null
                    }
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {group.count > group.items.length ? (
        <p className="mt-2 text-xs text-ink-muted">
          Showing {group.items.length} of {fmtCount(group.count)}. Work through these and the rest
          appear on the next refresh.
        </p>
      ) : null}
    </Card>
  );
}
