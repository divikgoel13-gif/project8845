import Link from "next/link";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { getPickupDemand } from "@/lib/admin/analytics";
import { fmtCount } from "@/lib/admin/format";
import { SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { BarChart, RankedBars } from "@/components/admin/analytics-charts";

/**
 * Pickup demand analytics (SRS Phase 9).
 *
 * Forward-looking, not historical — this page answers "when is the platform
 * about to get busy", which is a staffing question, not a reporting one. It
 * therefore has no 7/30/90-day switcher: the window is fixed to the next 7
 * days, campus-local, the same horizon lib/data/vendor-analytics.ts uses for
 * the single-restaurant version of this same chart.
 */

export const dynamic = "force-dynamic";

export default async function AnalyticsPickupDemandPage() {
  await requireSuperAdmin();

  const data = await getPickupDemand();

  // data.byHour is always populated with all 24 hours (see lib/admin/analytics.ts),
  // so a zero-count fallback keeps this typesafe without asserting non-null.
  const busiestHour = data.byHour.reduce(
    (best, h) => (h.count > best.count ? h : best),
    { hour: 0, count: 0 },
  );

  return (
    <div>
      <SectionHeading
        title="Pickup demand"
        description="Next 7 days, campus-local time. Scheduled and in-flight orders only — collected, cancelled and no-show orders carry no future pickup."
      />

      <StatGrid>
        <Stat label="Upcoming pickups" value={fmtCount(data.totalUpcoming)} hint="Next 7 days, platform-wide" />
        <Stat
          label="Busiest hour"
          value={data.totalUpcoming > 0 ? `${String(busiestHour.hour).padStart(2, "0")}:00` : "—"}
          hint={data.totalUpcoming > 0 ? `${fmtCount(busiestHour.count)} pickups` : "No upcoming pickups"}
        />
        <Stat
          label="Restaurants with upcoming pickups"
          value={fmtCount(data.topRestaurants.length)}
          hint="See breakdown below"
        />
        <Stat label="Live operations" value="Command centre" hint="Today's queue, not the 7-day forecast" href="/admin/operations" />
      </StatGrid>

      <Card className="mt-4">
        <h2 className="font-display text-base font-semibold text-ink">By hour of day</h2>
        <p className="mt-0.5 text-xs text-ink-muted">Campus-local hour, summed across all 7 upcoming days.</p>
        <BarChart data={data.byHour.map((h) => ({ label: String(h.hour), count: h.count }))} className="mt-4" />
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-display text-base font-semibold text-ink">By day of week</h2>
          <p className="mt-0.5 text-xs text-ink-muted">Which weekdays carry the most pickup volume.</p>
          <BarChart data={data.byDayOfWeek.map((d) => ({ label: d.label, count: d.count }))} className="mt-4" />
        </Card>

        <Card>
          <h2 className="font-display text-base font-semibold text-ink">Busiest restaurants</h2>
          <p className="mt-0.5 text-xs text-ink-muted">Top 10 by upcoming pickup count.</p>
          {data.topRestaurants.length === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">No upcoming pickups in the next 7 days.</p>
          ) : (
            <RankedBars
              className="mt-4"
              data={data.topRestaurants.map((r) => ({ label: r.name, count: r.count, href: `/admin/restaurants/${r.restaurantId}` }))}
              renderLabel={(item) => (
                <Link href={item.href ?? "#"} className="hover:underline">
                  {item.label}
                </Link>
              )}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
