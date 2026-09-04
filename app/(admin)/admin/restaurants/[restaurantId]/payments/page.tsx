import Link from "next/link";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { getVendorPayableSummary, listVendorPayableOrders } from "@/lib/data/vendor-payments";
import { paiseToRupeesDisplay } from "@/lib/money";
import { fmtDateTime, fmtCount, fmtRate, shortId, TIMEZONE_NOTE } from "@/lib/admin/format";
import { orderStatusLabel } from "@/lib/orders/status-groups";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Badge, orderStatusTone } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap, Table, THead, TBody, TR, TH, THNum, TD, TDNum } from "@/components/ui/table";

/**
 * Restaurant workspace payables (SRS §11 commission, §12 payouts, §14 reconciliation).
 *
 * This page answers "what does the platform owe this restaurant, and for which
 * orders". The Disbursements page answers "what has been sent". Splitting them is
 * what makes a dispute tractable: a vendor claiming a shortfall is either disputing
 * an order's payable (here) or a transfer (there), and one combined page forces the
 * operator to work out which from a single table.
 *
 * Every figure is the order's own snapshot. `commissionRateSnapshot` is displayed
 * per row precisely because the platform rate changes: an order placed under 12%
 * stays a 12% order forever (§11.5), and showing today's rate against an old order
 * is the specific error this column exists to prevent.
 *
 * Nothing here is editable. Correcting a payable is a refund or a cancellation
 * event — an additive ledger row — not an edit to the order.
 */

export const dynamic = "force-dynamic";

export default async function RestaurantPaymentsPage({ params }: { params: { restaurantId: string } }) {
  await requireSuperAdmin();
  const { restaurantId } = params;

  const [summary, rows] = await Promise.all([
    getVendorPayableSummary(restaurantId),
    listVendorPayableOrders(restaurantId),
  ]);

  const unsettled = rows.filter((r) => r.outstandingPaise > 0);

  return (
    <div>
      <PageHeader
        title="Payables"
        description={`What this restaurant has earned, order by order, using each order's own commission snapshot. Figures are never recomputed from today's rate. ${TIMEZONE_NOTE}.`}
        actions={
          <ButtonLink href={`/admin/restaurants/${restaurantId}/disbursements`} variant="secondary">
            Disbursements
          </ButtonLink>
        }
      />

      <StatGrid className="lg:grid-cols-5">
        <Stat label="Gross sales" value={paiseToRupeesDisplay(summary.grossSalesPaise)} hint="Paid orders, before commission" />
        <Stat label="Platform commission" value={paiseToRupeesDisplay(summary.commissionPaise)} hint="Sum of per-order snapshots" />
        <Stat label="Net payable" value={paiseToRupeesDisplay(summary.netPayablePaise)} hint="Gross less commission" />
        <Stat label="Disbursed" value={paiseToRupeesDisplay(summary.disbursedPaise)} hint="Allocated to orders, oldest first" />
        <Stat
          label="Outstanding"
          value={paiseToRupeesDisplay(summary.outstandingPaise)}
          hint="Net payable not yet covered by a disbursement"
          tone={summary.outstandingPaise > 0 ? "warning" : "success"}
        />
      </StatGrid>

      <Card className="mt-4">
        <p className="text-xs text-ink-muted">
          {`${fmtCount(summary.paidOrderCount)} paid orders contribute to these figures. ${fmtCount(unsettled.length)} still carry an outstanding balance. A disbursement is allocated to the oldest outstanding order first, so a partial payment settles orders in the sequence they were placed rather than spreading across all of them.`}
        </p>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          className="mt-4"
          title="No payable orders yet"
          hint="An order contributes to a payable once it is paid. Carts and unpaid orders never do."
        />
      ) : (
        <TableWrap className="mt-4">
          <Table>
            <THead>
              <TR>
                <TH>Order</TH>
                <TH>Placed</TH>
                <TH>Status</TH>
                <THNum>Gross</THNum>
                <THNum>Rate</THNum>
                <THNum>Commission</THNum>
                <THNum>Payable</THNum>
                <THNum>Disbursed</THNum>
                <THNum>Outstanding</THNum>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.orderId} className="hover:bg-cream-100">
                  <TD>
                    <Link
                      href={`/admin/orders/${r.orderId}`}
                      className="font-mono text-xs font-semibold text-ink hover:underline"
                    >
                      {shortId(r.orderId)}
                    </Link>
                  </TD>
                  <TD className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</TD>
                  <TD>
                    <Badge tone={orderStatusTone(r.status)}>{orderStatusLabel(r.status)}</Badge>
                  </TD>
                  <TDNum>{paiseToRupeesDisplay(r.grossPaise)}</TDNum>
                  <TDNum>{r.commissionRateSnapshot === null ? "—" : fmtRate(r.commissionRateSnapshot)}</TDNum>
                  <TDNum>{paiseToRupeesDisplay(r.commissionPaise)}</TDNum>
                  <TDNum>{paiseToRupeesDisplay(r.payablePaise)}</TDNum>
                  <TDNum>{paiseToRupeesDisplay(r.disbursedPaise)}</TDNum>
                  <TDNum
                    className={r.outstandingPaise > 0 ? "font-semibold text-warning" : undefined}
                  >
                    {paiseToRupeesDisplay(r.outstandingPaise)}
                  </TDNum>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}
