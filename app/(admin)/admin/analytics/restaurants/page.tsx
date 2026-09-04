import Link from "next/link";

import { requireSuperAdmin } from "@/lib/auth/guards";
import {
  getRestaurantComparison,
  parseRangeDays,
  type RestaurantComparisonSort,
} from "@/lib/admin/analytics";
import { paiseToRupeesDisplay } from "@/lib/money";
import { fmtCount, TIMEZONE_NOTE } from "@/lib/admin/format";
import { SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge, restaurantStatusTone } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap, Table, THead, TBody, TR, TH, THNum, TD, TDNum } from "@/components/ui/table";
import { AnalyticsRangeSwitcher } from "@/components/admin/analytics-range-switcher";

/**
 * Restaurant comparison analytics (SRS Phase 9).
 *
 * One row per non-archived restaurant, every column an aggregate over the
 * selected window except "Open now", which is deliberately a live figure —
 * see lib/admin/analytics.ts's comment on why ticket backlog isn't
 * date-ranged the same way GMV is.
 */

export const dynamic = "force-dynamic";

type Query = { days?: string; sort?: string };

const SORTS: { value: RestaurantComparisonSort; label: string }[] = [
  { value: "gmv", label: "Highest GMV" },
  { value: "orders", label: "Most orders" },
  { value: "aov", label: "Highest average order" },
  { value: "collection_rate", label: "Highest collection rate" },
  { value: "rating", label: "Highest rated" },
  { value: "tickets", label: "Most open tickets" },
];

function pickSort(raw: string | undefined): RestaurantComparisonSort {
  return SORTS.some((s) => s.value === raw) ? (raw as RestaurantComparisonSort) : "gmv";
}

export default async function AnalyticsRestaurantsPage({ searchParams }: { searchParams: Query }) {
  await requireSuperAdmin();

  const days = parseRangeDays(searchParams.days);
  const sort = pickSort(searchParams.sort);
  const data = await getRestaurantComparison(days, sort);

  const exportQs = new URLSearchParams({ days: String(days), sort });

  return (
    <div>
      <SectionHeading
        title="Restaurant comparison"
        description={`Last ${days} days, ${data.rows.length} restaurants. ${TIMEZONE_NOTE}.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AnalyticsRangeSwitcher current={days} basePath="/admin/analytics/restaurants" preserveParams={{ sort }} />
            <ButtonLink href={`/admin/analytics/restaurants/export?${exportQs.toString()}`} variant="secondary">
              Export CSV
            </ButtonLink>
          </div>
        }
      />

      {data.truncated ? (
        <Card className="mb-4 border-warning bg-warning-bg">
          <p className="text-xs text-warning">
            More orders exist in this window than one scan covers. Per-restaurant figures below are a floor.
            Narrow to 7 days for an exact comparison.
          </p>
        </Card>
      ) : null}

      <Card className="mb-4">
        <form method="get" action="/admin/analytics/restaurants" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="days" value={days} />
          <Field label="Sort by" htmlFor="sort" className="w-56">
            <Select id="sort" name="sort" defaultValue={sort}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit">Apply</Button>
        </form>
      </Card>

      {data.rows.length === 0 ? (
        <EmptyState title="No restaurants yet" hint="Add a restaurant from Restaurants to see it compared here." />
      ) : (
        <Card className="p-0">
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Restaurant</TH>
                  <TH>Status</TH>
                  <THNum>GMV</THNum>
                  <THNum>Orders</THNum>
                  <THNum>AOV</THNum>
                  <THNum>Collection rate</THNum>
                  <THNum>Rating</THNum>
                  <THNum>Open now</THNum>
                </TR>
              </THead>
              <TBody>
                {data.rows.map((r) => (
                  <TR key={r.restaurantId}>
                    <TD className="font-medium text-ink">
                      <Link href={`/admin/restaurants/${r.restaurantId}/dashboard`} className="hover:underline">
                        {r.name}
                      </Link>
                    </TD>
                    <TD>
                      <Badge tone={restaurantStatusTone(r.status)}>{r.status}</Badge>
                    </TD>
                    <TDNum>{paiseToRupeesDisplay(r.gmvPaise)}</TDNum>
                    <TDNum>{fmtCount(r.orderCount)}</TDNum>
                    <TDNum>{paiseToRupeesDisplay(r.aovPaise)}</TDNum>
                    <TDNum>{r.orderCount > 0 ? `${r.collectionRatePercent}%` : "—"}</TDNum>
                    <TDNum>{r.avgRating !== null ? `${r.avgRating.toFixed(1)} (${r.ratingCount})` : "—"}</TDNum>
                    <TDNum>
                      {r.openTicketCount > 0 ? (
                        <Link
                          href={`/admin/grievances?restaurant=${r.restaurantId}&status=open`}
                          className="font-semibold text-warning hover:underline"
                        >
                          {r.openTicketCount}
                        </Link>
                      ) : (
                        "0"
                      )}
                    </TDNum>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      )}
    </div>
  );
}
