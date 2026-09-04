import { requireSuperAdmin } from "@/lib/auth/guards";
import { getRestaurantContext } from "@/lib/admin/restaurant-context";
import { listWalkingTimesFor } from "@/lib/admin/restaurant-workspace";
import { fmtCount } from "@/lib/admin/format";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { WalkingTimesEditor } from "@/components/admin/walking-time-controls";

/**
 * Walking times from one restaurant to every other (SRS §2 walking-time matrix,
 * §9 "immediately after previous pickup", V2.6 §U).
 *
 * This is one restaurant's row of the matrix, not the whole matrix. A full N×N
 * grid is unreadable past about six restaurants and, more importantly, it is not
 * the shape of the question an operator has: they have just opened a new counter
 * and need to say how far it is from the ones that already exist.
 *
 * The number is not cosmetic. When a customer builds a group order across two
 * restaurants and chooses "immediately after previous pickup", the second pickup
 * time is the first plus this many minutes — and if neither direction of the pair
 * is configured, `resolveImmediateAfterTime` returns
 * `no_walking_time_configured` and the customer is refused that option and told
 * to pick a fixed time. So an unset pair is a feature switched off for those two
 * restaurants, which is what the tile below counts.
 *
 * Archived restaurants are absent by design — the reader excludes them. A pair
 * that can never be ordered from does not need a distance, and leaving them in
 * would make the "not set" count permanently non-zero and therefore ignorable.
 */

export const dynamic = "force-dynamic";

export default async function RestaurantWalkingTimesPage({
  params,
}: {
  params: { restaurantId: string };
}) {
  await requireSuperAdmin();
  const { restaurantId } = params;

  const [restaurant, rows] = await Promise.all([
    getRestaurantContext(restaurantId),
    listWalkingTimesFor(restaurantId),
  ]);

  // The layout has already 404'd an unknown id; this only narrows the type.
  if (!restaurant) return null;

  // "Configured" means the reader can produce a number, which it can from a
  // single direction — so a pair counts as unset only when BOTH are missing.
  const unset = rows.filter((r) => r.outboundMinutes === null && r.inboundMinutes === null);
  const oneWayOnly = rows.filter(
    (r) =>
      (r.outboundMinutes === null) !== (r.inboundMinutes === null)
  );
  const asymmetric = rows.filter(
    (r) =>
      r.outboundMinutes !== null &&
      r.inboundMinutes !== null &&
      r.outboundMinutes !== r.inboundMinutes
  );

  return (
    <div>
      <PageHeader
        title="Walking Times"
        description={`How long it takes to walk between ${restaurant.name} and each other restaurant. Used to space the pickup times in a group order when a customer chooses “immediately after previous pickup”.`}
      />

      <StatGrid className="lg:grid-cols-4">
        <Stat label="Other restaurants" value={fmtCount(rows.length)} hint="Active and paused; archived are excluded" />
        <Stat
          label="Pairs not set"
          value={fmtCount(unset.length)}
          hint="Group orders cannot chain these by walking time"
          tone={unset.length > 0 ? "warning" : "default"}
        />
        <Stat
          label="One direction only"
          value={fmtCount(oneWayOnly.length)}
          hint="Usable — the reader falls back to the direction that exists"
        />
        <Stat
          label="Asymmetric"
          value={fmtCount(asymmetric.length)}
          hint="Different each way, which campus geography sometimes is"
        />
      </StatGrid>

      {unset.length > 0 ? (
        <Card className="mt-4 border-warning bg-warning-bg">
          <p className="text-sm font-semibold text-ink">
            {fmtCount(unset.length)} pair{unset.length === 1 ? " has" : "s have"} no walking time in either direction.
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            A customer ordering from {restaurant.name} and one of these in the same group order is refused the
            “immediately after previous pickup” option and must choose a fixed time for the second restaurant. That is a
            correct refusal rather than a bug — the platform will not guess a distance — but it is worth filling in:{" "}
            {unset
              .slice(0, 6)
              .map((r) => r.otherName)
              .join(", ")}
            {unset.length > 6 ? ` and ${fmtCount(unset.length - 6)} more` : ""}.
          </p>
        </Card>
      ) : null}

      <Card className="mt-4">
        <SectionHeading
          title="Minutes on foot"
          description="“To there” is the walk out of this restaurant; “Back here” is the return. Save both ways when the walk is the same in each direction, which is the usual case. Save directions when it genuinely is not — a one-way gate or a stairwell that is only an exit."
        />
        <WalkingTimesEditor restaurantId={restaurant.id} restaurantName={restaurant.name} rows={rows} />
      </Card>

      <Card className="mt-4">
        <SectionHeading title="How the number is used" />
        <ul className="flex flex-col gap-1.5 text-xs text-ink-soft">
          <li>
            The second pickup time is the first pickup time plus these minutes, exactly — it is not rounded up to the
            next slot boundary, because rounding “for tidiness” would push the customer’s collection later than the walk
            requires.
          </li>
          <li>
            That computed minute is then checked against the second restaurant’s opening hours, slot capacity and
            cutoff. A walk that lands outside those is refused rather than quietly moved.
          </li>
          <li>
            Clearing a pair deletes the rows. It never writes 0 — 0 minutes would claim the two counters are the same
            place, and the planner would schedule both pickups at the same instant.
          </li>
          <li>Every change here is audit logged against this restaurant with the account that made it.</li>
        </ul>
      </Card>
    </div>
  );
}
