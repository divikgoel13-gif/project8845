import Link from "next/link";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { listGlobalOrders, type OrderListFilters } from "@/lib/admin/orders";
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
 * Restaurant workspace orders (SRS §5.3 OPERATIONS, §13).
 *
 * This is `listGlobalOrders` with `restaurantId` pinned, not a new reader. The
 * restaurant filter cannot be changed from here and is not rendered as a control:
 * the workspace's whole premise (§5.3) is that the restaurant is fixed context, so
 * a restaurant dropdown on this page would let an operator silently leave the
 * workspace they think they are in.
 *
 * Order detail links go to the GLOBAL `/admin/orders/[id]` route. A multi-restaurant
 * group order has siblings at other restaurants, and a workspace-scoped detail page
 * would either have to hide them — losing the reason the order looks odd — or show
 * rows from outside this workspace.
 */

export const dynamic = "force-dynamic";

type Query = { status?: string; from?: string; to?: string; q?: string; page?: string };

const SYNTHETIC = new Set(["all", "realized", "in_flight"]);

function parseStatus(raw: string | undefined): OrderListFilters["status"] {
  if (!raw) return undefined;
  if (SYNTHETIC.has(raw)) return raw as OrderListFilters["status"];
  return (ORDER_STATUS_FILTERS as readonly string[]).includes(raw) ? (raw as OrderStatus) : undefined;
}

function parseDate(raw: string | undefined): string | undefined {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

export default async function RestaurantOrdersPage({
  params,
  searchParams,
}: {
  params: { restaurantId: string };
  searchParams: Query;
}) {
  await requireSuperAdmin();
  const { restaurantId } = params;
  const basePath = `/admin/restaurants/${restaurantId}/orders`;

  const result = await listGlobalOrders({
    restaurantId,
    status: parseStatus(searchParams.status),
    fromDate: parseDate(searchParams.from),
    toDate: parseDate(searchParams.to),
    search: searchParams.q?.trim() || undefined,
    page: parsePage(searchParams.page),
  });

  const carried: Record<string, string | undefined> = {
    status: searchParams.status,
    from: searchParams.from,
    to: searchParams.to,
    q: searchParams.q,
  };

  const exportQs = new URLSearchParams({ restaurantId });
  for (const [key, value] of Object.entries(carried)) if (value) exportQs.set(key, value);

  return (
    <div>
      <PageHeader
        title="Orders"
        description={`Every order at this restaurant. Money shown is the order's own snapshot, never recomputed from today's commission rate. ${TIMEZONE_NOTE}.`}
        actions={
          <ButtonLink href={`/admin/orders/export?${exportQs.toString()}`} variant="secondary">
            Export CSV
          </ButtonLink>
        }
      />

      <StatGrid className="lg:grid-cols-3">
        <Stat
          label="Realized GMV"
          value={paiseToRupeesDisplay(result.totals.realizedGmvPaise)}
          hint="Filtered set, gross of commission. Excludes cancelled and refunded."
        />
        <Stat label="Realized orders" value={fmtCount(result.totals.realizedCount)} hint="Paid or later" />
        <Stat
          label="Platform commission"
          value={paiseToRupeesDisplay(result.totals.commissionPaise)}
          hint="Sum of each order's commission snapshot"
        />
      </StatGrid>

      <Card className="mt-4">
        <form method="get" action={basePath} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

          <div className="grid grid-cols-2 gap-3">
            <Field label="From" htmlFor="from" hint="Campus date">
              <Input id="from" type="date" name="from" defaultValue={searchParams.from ?? ""} />
            </Field>
            <Field label="To" htmlFor="to" hint="Campus date">
              <Input id="to" type="date" name="to" defaultValue={searchParams.to ?? ""} />
            </Field>
          </div>

          <div className="flex items-end gap-2">
            <Button type="submit">Apply</Button>
            <ButtonLink href={basePath} variant="ghost">
              Reset
            </ButtonLink>
          </div>
        </form>
      </Card>

      {result.rows.length === 0 ? (
        <EmptyState
          className="mt-4"
          title="No orders match these filters"
          hint="Carts are excluded from every view here — an abandoned basket is not an order."
        />
      ) : (
        <>
          <TableWrap className="mt-4">
            <Table>
              <THead>
                <TR>
                  <TH>Order</TH>
                  <TH>Placed</TH>
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
                {result.rows.map((o) => (
                  <TR key={o.id} className="hover:bg-cream-100">
                    <TD>
                      <Link
                        href={`/admin/orders/${o.id}`}
                        className="font-mono text-xs font-semibold text-ink hover:underline"
                      >
                        {shortId(o.id)}
                      </Link>
                      {o.groupId ? (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide text-ink-muted">multi</span>
                      ) : null}
                    </TD>
                    <TD className="whitespace-nowrap">{fmtDateTime(o.createdAt)}</TD>
                    <TD>
                      <Link href={`/admin/customers/${o.customerId}`} className="hover:text-ink hover:underline">
                        {o.customerName ?? "Unknown"}
                      </Link>
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
            total={result.total}
            basePath={basePath}
            params={carried}
          />
        </>
      )}
    </div>
  );
}
