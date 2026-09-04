import { requireSuperAdmin } from "@/lib/auth/guards";
import {
  getProductPerformance,
  parseRangeDays,
  type ProductPerformanceSort,
} from "@/lib/admin/analytics";
import { listRestaurantOptions } from "@/lib/admin/restaurants";
import { paiseToRupeesDisplay } from "@/lib/money";
import { fmtCount } from "@/lib/admin/format";
import { SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap, Table, THead, TBody, TR, TH, THNum, TD, TDNum } from "@/components/ui/table";
import { AnalyticsRangeSwitcher } from "@/components/admin/analytics-range-switcher";

/**
 * Product performance analytics (SRS Phase 9).
 *
 * Grouped by (restaurant, product), never by name alone — see
 * lib/admin/analytics.ts's getProductPerformance for why two restaurants
 * both selling "Masala Chai" must stay two rows. Revenue is quantity × the
 * order_item's own price snapshot (SRS §11.5), never today's menu price.
 */

export const dynamic = "force-dynamic";

type Query = { days?: string; sort?: string; restaurant?: string };

const SORTS: { value: ProductPerformanceSort; label: string }[] = [
  { value: "quantity", label: "Most sold" },
  { value: "revenue", label: "Highest revenue" },
];

function pickSort(raw: string | undefined): ProductPerformanceSort {
  return raw === "revenue" ? "revenue" : "quantity";
}

const TOP_N = 50;

export default async function AnalyticsProductsPage({ searchParams }: { searchParams: Query }) {
  await requireSuperAdmin();

  const days = parseRangeDays(searchParams.days);
  const sort = pickSort(searchParams.sort);
  const restaurantId = searchParams.restaurant?.trim() || undefined;

  const [data, restaurantOptions] = await Promise.all([
    getProductPerformance(days, sort, restaurantId),
    listRestaurantOptions(),
  ]);

  const rows = data.rows.slice(0, TOP_N);
  const exportQs = new URLSearchParams({ days: String(days), sort });
  if (restaurantId) exportQs.set("restaurant", restaurantId);

  return (
    <div>
      <SectionHeading
        title="Product performance"
        description={
          data.restaurantFilter
            ? `Last ${days} days, ${data.restaurantFilter.name} only.`
            : `Last ${days} days, all restaurants. Top ${TOP_N} of ${fmtCount(data.rows.length)} products shown.`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AnalyticsRangeSwitcher
              current={days}
              basePath="/admin/analytics/products"
              preserveParams={{ sort, restaurant: restaurantId }}
            />
            <ButtonLink href={`/admin/analytics/products/export?${exportQs.toString()}`} variant="secondary">
              Export CSV
            </ButtonLink>
          </div>
        }
      />

      {data.truncated ? (
        <Card className="mb-4 border-warning bg-warning-bg">
          <p className="text-xs text-warning">
            This window has more orders or line items than one scan covers. Figures below are a floor. Narrow
            to 7 days, or filter to one restaurant, for an exact reconciliation.
          </p>
        </Card>
      ) : null}

      <Card className="mb-4">
        <form method="get" action="/admin/analytics/products" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="days" value={days} />
          <Field label="Restaurant" htmlFor="restaurant" className="w-64">
            <Select id="restaurant" name="restaurant" defaultValue={restaurantId ?? ""}>
              <option value="">All restaurants</option>
              {restaurantOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sort by" htmlFor="sort" className="w-52">
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

      {rows.length === 0 ? (
        <EmptyState
          title="No sales in this window"
          hint={data.restaurantFilter ? "Try a wider date range, or clear the restaurant filter." : "Try a wider date range."}
        />
      ) : (
        <Card className="p-0">
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  {data.restaurantFilter ? null : <TH>Restaurant</TH>}
                  <THNum>Quantity sold</THNum>
                  <THNum>Revenue</THNum>
                </TR>
              </THead>
              <TBody>
                {rows.map((r, i) => (
                  <TR key={`${r.restaurantId}-${r.productId ?? r.name}-${i}`}>
                    <TD className="font-medium text-ink">{r.name}</TD>
                    {data.restaurantFilter ? null : <TD>{r.restaurantName}</TD>}
                    <TDNum>{fmtCount(r.quantitySold)}</TDNum>
                    <TDNum>{paiseToRupeesDisplay(r.revenuePaise)}</TDNum>
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
