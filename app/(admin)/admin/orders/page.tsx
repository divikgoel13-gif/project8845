import Link from "next/link";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { listGlobalOrders, type OrderListFilters } from "@/lib/admin/orders";
import { listRestaurantOptions } from "@/lib/admin/restaurants";
import { paiseToRupeesDisplay } from "@/lib/money";
import { fmtDateTime, fmtTime, shortId, fmtCount, TIMEZONE_NOTE } from "@/lib/admin/format";
import { ORDER_STATUS_FILTERS, orderStatusLabel, type OrderStatus } from "@/lib/orders/status-groups";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Badge, orderStatusTone } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap, Table, THead, TBody, TR, TH, THNum, TD, TDNum } from "@/components/ui/table";
import { Pagination, parsePage } from "@/components/ui/pagination";

/**
 * Global cross-restaurant order search (SRS §6 "Orders", §13).
 *
 * Every filter is a plain GET form field, so the whole screen works with
 * JavaScript disabled and any filtered view is a shareable URL (§13 asks an
 * operator to be able to hand a colleague "the failed orders from Tuesday").
 * That is also why there is no client component here at all.
 */

export const dynamic = "force-dynamic";

type Query = {
  status?: string;
  restaurantId?: string;
  customerId?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: string;
};

const SYNTHETIC = new Set(["all", "realized", "in_flight"]);

function parseStatus(raw: string | undefined): OrderListFilters["status"] {
  if (!raw) return undefined;
  if (SYNTHETIC.has(raw)) return raw as OrderListFilters["status"];
  return (ORDER_STATUS_FILTERS as readonly string[]).includes(raw) ? (raw as OrderStatus) : undefined;
}

/** `YYYY-MM-DD` only. A malformed date is dropped rather than 500ing the page. */
function parseDate(raw: string | undefined): string | undefined {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

export default async function AdminOrdersPage({ searchParams }: { searchParams: Query }) {
  await requireSuperAdmin();

  const page = parsePage(searchParams.page);
  const filters: OrderListFilters = {
    status: parseStatus(searchParams.status),
    restaurantId: searchParams.restaurantId || undefined,
    customerId: searchParams.customerId || undefined,
    fromDate: parseDate(searchParams.from),
    toDate: parseDate(searchParams.to),
    search: searchParams.q?.trim() || undefined,
    page,
  };

  const [result, restaurants] = await Promise.all([listGlobalOrders(filters), listRestaurantOptions()]);
  const { rows, total, totals } = result;

  // Preserved verbatim across pagination links so page 2 keeps the filter set.
  const carried: Record<string, string | undefined> = {
    status: searchParams.status,
    restaurantId: searchParams.restaurantId,
    customerId: searchParams.customerId,
    from: searchParams.from,
    to: searchParams.to,
    q: searchParams.q,
  };

  const exportQs = new URLSearchParams();
  for (const [key, value] of Object.entries(carried)) if (value) exportQs.set(key, value);

  return (
    <div>
      <PageHeader
        title="Orders"
        description={`Every order across every restaurant. Money shown is the order's own snapshot, never recomputed from today's commission rate. ${TIMEZONE_NOTE}.`}
        actions={
          <ButtonLink
            href={`/admin/orders/export${exportQs.toString() ? `?${exportQs.toString()}` : ""}`}
            variant="secondary"
          >
            Export CSV
          </ButtonLink>
        }
      />

      <StatGrid className="lg:grid-cols-3">
        <Stat
          label="Realized GMV"
          value={paiseToRupeesDisplay(totals.realizedGmvPaise)}
          hint="Filtered set, gross of commission. Excludes cancelled and refunded."
        />
        <Stat
          label="Realized orders"
          value={fmtCount(totals.realizedCount)}
          hint="Paid or later, across the whole filtered set"
        />
        <Stat
          label="Platform commission"
          value={paiseToRupeesDisplay(totals.commissionPaise)}
          hint="Sum of each order's commission snapshot"
        />
      </StatGrid>

      <Card className="mt-4">
        <form method="get" action="/admin/orders" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Search" htmlFor="q" hint="Order id prefix, or customer name / email / phone">
            <Input id="q" name="q" defaultValue={searchParams.q ?? ""} placeholder="3f2a… or Priya" />
          </Field>

          <Field label="Status" htmlFor="status">
            <Select id="status" name="status" defaultValue={searchParams.status ?? "all"}>
              <option value="all">All (excludes carts)</option>
              <option value="realized">Realized sales</option>
              <option value="in_flight">In flight (owed to a customer)</option>
              {ORDER_STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {orderStatusLabel(s)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Restaurant" htmlFor="restaurantId">
            <Select id="restaurantId" name="restaurantId" defaultValue={searchParams.restaurantId ?? ""}>
              <option value="">All restaurants</option>
              {restaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.status === "archived" ? " (archived)" : ""}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="From" htmlFor="from" hint="Campus date, inclusive">
            <Input id="from" type="date" name="from" defaultValue={searchParams.from ?? ""} />
          </Field>

          <Field label="To" htmlFor="to" hint="Campus date, inclusive">
            <Input id="to" type="date" name="to" defaultValue={searchParams.to ?? ""} />
          </Field>

          <div className="flex items-end gap-2">
            <Button type="submit">Apply</Button>
            <ButtonLink href="/admin/orders" variant="ghost">
              Reset
            </ButtonLink>
          </div>

          {/* Kept so a link from Customer 360 survives a re-filter. */}
          {searchParams.customerId ? (
            <input type="hidden" name="customerId" value={searchParams.customerId} />
          ) : null}
        </form>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          className="mt-4"
          title="No orders match these filters"
          hint="Carts are excluded from every view here — an abandoned basket is not an order. Widen the date range or clear the search to see more."
        />
      ) : (
        <>
          <TableWrap className="mt-4">
            <Table>
              <THead>
                <TR>
                  <TH>Order</TH>
                  <TH>Placed</TH>
                  <TH>Restaurant</TH>
                  <TH>Customer</TH>
                  <TH>Status</TH>
                  <TH>Pickup</TH>
                  <THNum>Items</THNum>
                  <THNum>Subtotal</THNum>
                  <THNum>Commission</THNum>
                  <THNum>Vendor payable</THNum>
                </TR>
              </THead>
              <TBody>
                {rows.map((o) => (
                  <TR key={o.id} className="hover:bg-cream-100">
                    <TD>
                      <Link href={`/admin/orders/${o.id}`} className="font-mono text-xs font-semibold text-ink hover:underline">
                        {shortId(o.id)}
                      </Link>
                      {o.groupId ? (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide text-ink-muted">multi</span>
                      ) : null}
                    </TD>
                    <TD className="whitespace-nowrap">{fmtDateTime(o.createdAt)}</TD>
                    <TD>
                      <Link
                        href={`/admin/restaurants/${o.restaurantId}/dashboard`}
                        className="hover:text-ink hover:underline"
                      >
                        {o.restaurantName}
                      </Link>
                    </TD>
                    <TD>
                      <Link href={`/admin/customers/${o.customerId}`} className="hover:text-ink hover:underline">
                        {o.customerName ?? "Unknown"}
                      </Link>
                      {o.customerEmail ? (
                        <span className="block text-[11px] text-ink-muted">{o.customerEmail}</span>
                      ) : null}
                    </TD>
                    <TD>
                      <Badge tone={orderStatusTone(o.status)}>{orderStatusLabel(o.status)}</Badge>
                    </TD>
                    <TD className="whitespace-nowrap">
                      {o.collectedAt ? `Collected ${fmtTime(o.collectedAt)}` : fmtTime(o.pickupTime)}
                    </TD>
                    <TDNum>{o.itemCount}</TDNum>
                    <TDNum>{paiseToRupeesDisplay(o.subtotalPaise)}</TDNum>
                    <TDNum>
                      {o.commissionAmountPaise === null ? "—" : paiseToRupeesDisplay(o.commissionAmountPaise)}
                    </TDNum>
                    <TDNum>{o.vendorPayablePaise === null ? "—" : paiseToRupeesDisplay(o.vendorPayablePaise)}</TDNum>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>

          <Pagination
            className="mt-4"
            page={result.page}
            pageSize={result.pageSize}
            total={total}
            basePath="/admin/orders"
            params={carried}
          />
        </>
      )}
    </div>
  );
}
