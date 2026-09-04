import Link from "next/link";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { getRestaurantContext, restaurantOperationalState, restaurantStateLabel } from "@/lib/admin/restaurant-context";
import { getVendorAnalytics } from "@/lib/data/vendor-analytics";
import { getVendorPayableSummary } from "@/lib/data/vendor-payments";
import { paiseToRupeesDisplay } from "@/lib/money";
import { fmtCount, fmtDuration, TIMEZONE_NOTE } from "@/lib/admin/format";
import { acceptsNewOrders, newOrderBlockReason } from "@/lib/restaurants/status";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap, Table, THead, TBody, TR, TH, THNum, TD, TDNum } from "@/components/ui/table";
import { TrendBars } from "@/components/admin/trend-bars";

/**
 * Restaurant workspace dashboard (SRS §5.3 OVERVIEW, §6 KPI set).
 *
 * Every number on this page comes from the SAME readers the vendor's own
 * dashboard uses (`getVendorAnalytics`, `getVendorPayableSummary`). That is the
 * point: when a vendor phones to dispute a figure, the operator must be looking
 * at the identical computation, not an admin-side reimplementation that rounds
 * differently. §14's "reconcile with source data" is only checkable if there is
 * one definition of each metric.
 *
 * The payable summary is read separately from the analytics because they answer
 * different questions — `outstandingPaise` here is money owed to the vendor after
 * disbursements, while the analytics' own `outstandingPaise` is the value of
 * orders not yet collected. Two things called "outstanding" is exactly the kind
 * of ambiguity the `hint` on each tile exists to remove.
 */

export const dynamic = "force-dynamic";

export default async function RestaurantDashboardPage({ params }: { params: { restaurantId: string } }) {
  await requireSuperAdmin();
  const { restaurantId } = params;

  const [restaurant, analytics, payable] = await Promise.all([
    getRestaurantContext(restaurantId),
    getVendorAnalytics(restaurantId),
    getVendorPayableSummary(restaurantId),
  ]);

  // The layout has already 404'd an unknown id; this only narrows the type.
  if (!restaurant) return null;

  const state = restaurantOperationalState(restaurant);
  const trading = acceptsNewOrders(restaurant);
  const blockReason = newOrderBlockReason(restaurant);

  // `newOrderBlockReason` returns the machine vocabulary `checkPickupFeasibility`
  // uses. Rendering the code itself would put "restaurant_not_trading" in front of
  // an operator, so it is translated here rather than the helper being changed —
  // the customer-facing pickup path depends on those exact codes.
  const BLOCK_COPY: Record<NonNullable<typeof blockReason>, string> = {
    restaurant_archived: "This restaurant is archived.",
    restaurant_not_trading: "This restaurant is closed.",
    restaurant_paused: "This restaurant is paused.",
  };

  // `TrendBars` wants GMV and order count per day, but the two live in different
  // series: `salesTrend` is 14 days of money, `ordersTrend` is 30 days of counts.
  // Merging by date and keeping the money series' window is deliberate — showing
  // 30 bars of which 16 have no GMV would read as a collapse in sales.
  const countsByDate = new Map(analytics.ordersTrend.map((d) => [d.date, d.count]));
  const trend = analytics.salesTrend.map((d) => ({
    date: d.date,
    gmvPaise: d.gmvPaise,
    orderCount: countsByDate.get(d.date) ?? 0,
  }));

  const settled = analytics.collectedVsCancelled;
  const attempted = settled.collected + settled.cancelled + settled.noShow;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Today's trading for ${restaurant.name}, plus the 14-day trend. Money is the sum of each order's own snapshot, never recomputed. ${TIMEZONE_NOTE}.`}
        actions={
          <ButtonLink href={`/admin/restaurants/${restaurantId}/orders`} variant="secondary">
            View orders
          </ButtonLink>
        }
      />

      {!trading ? (
        <Card className="mb-4 border-warning bg-warning-bg">
          <p className="text-sm font-semibold text-warning">Not accepting new orders</p>
          <p className="mt-1 text-xs text-ink-soft">
            {blockReason ? BLOCK_COPY[blockReason] : "This restaurant is not currently open for new orders."}{" "}
            {restaurant.pausedReason?.trim() || restaurant.closedReason?.trim() || ""} Orders already placed are
            unaffected and must still be fulfilled.
          </p>
          <ButtonLink
            href={`/admin/restaurants/${restaurantId}/settings`}
            variant="ghost"
            size="sm"
            className="mt-3"
          >
            Change state
          </ButtonLink>
        </Card>
      ) : null}

      <StatGrid>
        <Stat label="GMV today" value={paiseToRupeesDisplay(analytics.gmvPaise)} hint="Gross of commission, campus day" />
        <Stat label="Orders today" value={fmtCount(analytics.orderCount)} hint="Paid or later, excludes carts" />
        <Stat label="Average order" value={paiseToRupeesDisplay(analytics.aovPaise)} hint="Today's GMV ÷ today's orders" />
        <Stat
          label="In flight"
          value={fmtCount(analytics.pendingCount)}
          hint={`${paiseToRupeesDisplay(analytics.outstandingPaise)} paid but not yet collected`}
          tone={analytics.pendingCount > 0 ? "warning" : "default"}
          href={`/admin/restaurants/${restaurantId}/orders?status=in_flight`}
        />
      </StatGrid>

      <StatGrid className="mt-3 lg:grid-cols-4">
        <Stat
          label="Outstanding payable"
          value={paiseToRupeesDisplay(payable.outstandingPaise)}
          hint="Owed to this vendor after disbursements"
          tone={payable.outstandingPaise > 0 ? "warning" : "success"}
          href={`/admin/restaurants/${restaurantId}/payments`}
        />
        <Stat
          label="Platform commission"
          value={paiseToRupeesDisplay(payable.commissionPaise)}
          hint="Lifetime, from each order's rate snapshot"
        />
        <Stat
          label="Upcoming pickups"
          value={fmtCount(analytics.upcomingPickupCount)}
          hint="Scheduled in the next 7 days"
          href={`/admin/restaurants/${restaurantId}/pickup`}
        />
        <Stat
          label="Repeat customers"
          value={`${analytics.repeatCustomerSharePercent}%`}
          hint="Share of customers with more than one order here"
        />
      </StatGrid>

      {analytics.alerts.length > 0 ? (
        <Card className="mt-4">
          <SectionHeading
            title="Needs attention"
            description="Conditions a vendor is expected to fix. Each one is a live count, not a stored flag."
          />
          <ul className="flex flex-col gap-2">
            {analytics.alerts.map((alert) => (
              <li key={alert.type} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-ink-soft">{alert.message}</span>
                <Link
                  href={
                    alert.type === "out_of_stock"
                      ? `/admin/restaurants/${restaurantId}/products`
                      : `/admin/restaurants/${restaurantId}/orders?status=in_flight`
                  }
                  className="text-xs font-semibold text-maroon-500 hover:underline"
                >
                  {alert.type === "out_of_stock" ? "Review products" : "Review orders"} ({fmtCount(alert.count)})
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <SectionHeading title="Sales, last 14 campus days" description="Bars are GMV. Every value is also in the table." />
          <TrendBars data={trend} />
        </Card>

        <Card>
          <SectionHeading
            title="Outcomes"
            description="Across the whole period the analytics reader covers — how orders finished, not how many were placed."
          />
          {attempted === 0 ? (
            <EmptyState title="No completed orders yet" hint="Outcomes appear once orders reach a terminal state." />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Outcome</TH>
                    <THNum>Orders</THNum>
                    <THNum>Share</THNum>
                  </TR>
                </THead>
                <TBody>
                  {(
                    [
                      ["Collected", settled.collected, "success"],
                      ["Cancelled", settled.cancelled, "danger"],
                      ["No-show", settled.noShow, "warning"],
                    ] as const
                  ).map(([label, count, tone]) => (
                    <TR key={label}>
                      <TD>
                        <Badge tone={tone}>{label}</Badge>
                      </TD>
                      <TDNum>{fmtCount(count)}</TDNum>
                      <TDNum>{Math.round((count / attempted) * 100)}%</TDNum>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <SectionHeading title="Top products today" description="By revenue, using each order item's price snapshot." />
          {analytics.topProducts.length === 0 ? (
            <EmptyState title="No items sold today" />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Product</TH>
                    <THNum>Sold</THNum>
                    <THNum>Revenue</THNum>
                  </TR>
                </THead>
                <TBody>
                  {analytics.topProducts.map((p) => (
                    <TR key={p.name}>
                      <TD>{p.name}</TD>
                      <TDNum>{fmtCount(p.quantitySold)}</TDNum>
                      <TDNum>{paiseToRupeesDisplay(p.revenuePaise)}</TDNum>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>

        <Card>
          <SectionHeading
            title="Operational policy"
            description="The windows this restaurant's slots are built from. Change them in Restaurant Settings."
          />
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Detail label="State" value={restaurantStateLabel(state)} />
            <Detail label="Preparation default" value={fmtDuration(restaurant.preparationDefaultMinutes)} />
            <Detail label="Grace period" value={fmtDuration(restaurant.gracePeriodMinutes)} />
            <Detail label="Slot interval" value={fmtDuration(restaurant.pickupSlotIntervalMinutes)} />
            <Detail label="Default slot capacity" value={`${restaurant.defaultSlotCapacity} orders`} />
            <Detail
              label="Classification"
              value={
                restaurant.locationType === "inside_university"
                  ? `Inside university${restaurant.universityPlaceName ? ` · ${restaurant.universityPlaceName}` : ""}`
                  : "Outside university"
              }
            />
          </dl>
        </Card>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  );
}
