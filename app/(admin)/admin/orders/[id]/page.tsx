import Link from "next/link";
import { notFound } from "next/navigation";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { getOrderDetailForAdmin } from "@/lib/admin/orders";
import { paiseToRupeesDisplay } from "@/lib/money";
import { fmtDateTime, fmtRate, humanise, shortId, TIMEZONE_NOTE } from "@/lib/admin/format";
import { orderStatusLabel } from "@/lib/orders/status-groups";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge, orderStatusTone, grievanceStatusTone, grievancePriorityTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap, Table, THead, TBody, TR, TH, THNum, TD, TDNum } from "@/components/ui/table";

/**
 * Single order, everything an operator needs on a support call (SRS §6, §13, §16).
 *
 * The money band shows the order's SNAPSHOT figures and says so on the page,
 * because §11.5/§23 guarantee a historical order is unaffected by a later
 * commission change and an operator has no other way to tell whether the number
 * in front of them was recomputed.
 *
 * Refunds are not initiated here: §16 routes every refund through a grievance
 * ticket so it carries a reason and an owner. This page links to the ticket
 * instead of offering a second, unattributed path to the same money movement.
 */

export const dynamic = "force-dynamic";

export default async function AdminOrderDetailPage({ params }: { params: { id: string } }) {
  await requireSuperAdmin();
  const order = await getOrderDetailForAdmin(params.id);
  if (!order) notFound();

  const itemsTotal = order.items.reduce((sum, i) => sum + i.lineTotalPaise, 0);
  // Only 'succeeded' counts as money that has actually left the platform.
  // 'requested'/'approved'/'initiated' are intents and 'rejected'/'failed' are
  // non-events; summing them would overstate what the customer has back.
  const refundedTotal = order.refunds
    .filter((r) => r.status === "succeeded")
    .reduce((sum, r) => sum + r.amountPaise, 0);
  const groupTotal = order.siblings.reduce((sum, s) => sum + s.subtotalPaise, order.money.subtotalPaise);

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Orders", href: "/admin/orders" },
          { label: shortId(order.id) },
        ]}
        title={`Order ${shortId(order.id)}`}
        description={`${order.restaurant.name} · ${order.customer.name ?? "Unknown customer"} · ${TIMEZONE_NOTE}.`}
        actions={<Badge tone={orderStatusTone(order.status)}>{orderStatusLabel(order.status)}</Badge>}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionHeading
            title="Items"
            description="Names and prices are the snapshots taken at checkout, not today's menu."
          />
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Item</TH>
                  <THNum>Unit price</THNum>
                  <THNum>Qty</THNum>
                  <THNum>Line total</THNum>
                </TR>
              </THead>
              <TBody>
                {order.items.map((i) => (
                  <TR key={i.id}>
                    <TD className="text-ink">{i.nameSnapshot}</TD>
                    <TDNum>{paiseToRupeesDisplay(i.pricePaise)}</TDNum>
                    <TDNum>{i.quantity}</TDNum>
                    <TDNum>{paiseToRupeesDisplay(i.lineTotalPaise)}</TDNum>
                  </TR>
                ))}
                <TR className="bg-cream-100 font-semibold">
                  <TD className="text-ink">Subtotal</TD>
                  <TDNum />
                  <TDNum />
                  <TDNum>{paiseToRupeesDisplay(order.money.subtotalPaise)}</TDNum>
                </TR>
              </TBody>
            </Table>
          </TableWrap>
          {itemsTotal !== order.money.subtotalPaise ? (
            // Surfaced rather than hidden: a mismatch means the stored subtotal
            // and the line snapshots disagree, which is a data-integrity problem
            // finance needs to see, not something a page should quietly paper over.
            <p className="mt-3 rounded-brand bg-danger-bg px-3 py-2 text-xs text-danger">
              Line items sum to {paiseToRupeesDisplay(itemsTotal)} but the stored subtotal is{" "}
              {paiseToRupeesDisplay(order.money.subtotalPaise)}. Flag this to finance — the stored value is
              authoritative for payout.
            </p>
          ) : null}
        </Card>

        <Card>
          <SectionHeading title="Money" description="Snapshot values, never recomputed (SRS §11.5)." />
          <dl className="space-y-2 text-sm">
            <Row label="Subtotal" value={paiseToRupeesDisplay(order.money.subtotalPaise)} />
            <Row label="Commission rate at checkout" value={fmtRate(order.money.commissionRateSnapshot)} />
            <Row
              label="Platform commission"
              value={
                order.money.commissionAmountPaise === null
                  ? "—"
                  : paiseToRupeesDisplay(order.money.commissionAmountPaise)
              }
            />
            <Row
              label="Vendor payable"
              value={
                order.money.vendorPayablePaise === null ? "—" : paiseToRupeesDisplay(order.money.vendorPayablePaise)
              }
            />
            {order.money.cancelPenaltyAmountPaise !== null ? (
              <>
                <Row label="Cancellation penalty rate" value={fmtRate(order.money.cancelPenaltyRate)} />
                <Row
                  label="Cancellation penalty"
                  value={paiseToRupeesDisplay(order.money.cancelPenaltyAmountPaise)}
                />
              </>
            ) : null}
            {refundedTotal > 0 ? (
              <Row label="Refunded to date" value={paiseToRupeesDisplay(refundedTotal)} tone="danger" />
            ) : null}
          </dl>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <SectionHeading title="Timeline" />
          <dl className="space-y-2 text-sm">
            <Row label="Placed" value={fmtDateTime(order.createdAt)} />
            <Row label="Pickup time" value={fmtDateTime(order.pickupTime)} />
            <Row
              label="Marked ready"
              value={
                order.readyAt
                  ? `${fmtDateTime(order.readyAt)}${order.readySource ? ` (${order.readySource})` : ""}`
                  : "—"
              }
            />
            <Row label="Collected" value={fmtDateTime(order.collectedAt)} />
            {order.noShowAt ? <Row label="Marked no-show" value={fmtDateTime(order.noShowAt)} tone="danger" /> : null}
            {order.cancelledAt ? (
              <>
                <Row label="Cancelled" value={fmtDateTime(order.cancelledAt)} tone="danger" />
                <Row label="Cancelled by" value={order.cancelledByName ?? "System"} />
                <Row label="Reason" value={order.cancelReason ?? "Not recorded"} />
              </>
            ) : null}
            <Row label="Last updated" value={fmtDateTime(order.updatedAt)} />
          </dl>
        </Card>

        <Card>
          <SectionHeading title="Customer" />
          <dl className="space-y-2 text-sm">
            <Row label="Name" value={order.customer.name ?? "Unknown"} />
            <Row label="Email" value={order.customer.email ?? "—"} />
            <Row label="Phone" value={order.customer.phone ?? "—"} />
          </dl>
          <Link
            href={`/admin/customers/${order.customer.id}`}
            className="mt-3 inline-block text-xs font-semibold text-maroon-500 hover:underline"
          >
            Open Customer 360
          </Link>
        </Card>

        <Card>
          <SectionHeading title="Restaurant" />
          <dl className="space-y-2 text-sm">
            <Row label="Name" value={order.restaurant.name} />
            <Row label="Status" value={humanise(order.restaurant.status)} />
            <Row label="Location" value={humanise(order.restaurant.locationType)} />
          </dl>
          <Link
            href={`/admin/restaurants/${order.restaurant.id}/dashboard`}
            className="mt-3 inline-block text-xs font-semibold text-maroon-500 hover:underline"
          >
            Open restaurant workspace
          </Link>
        </Card>
      </div>

      <Card className="mt-4">
        <SectionHeading
          title="Payment"
          description="A multi-restaurant checkout is ONE payment spanning several orders, joined by checkout group."
        />
        {order.payment ? (
          <>
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <Row label="Payment status" value={humanise(order.payment.status)} />
              <Row label="Amount charged" value={paiseToRupeesDisplay(order.payment.amountPaise)} />
              <Row label="Razorpay order" value={order.payment.razorpayOrderId ?? "—"} mono />
              <Row label="Razorpay payment" value={order.payment.razorpayPaymentId ?? "—"} mono />
              <Row label="Captured" value={fmtDateTime(order.payment.createdAt)} />
              <Row label="Checkout group" value={order.groupId ? shortId(order.groupId) : "—"} mono />
            </div>

            {order.siblings.length > 0 ? (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Other orders in this checkout
                </p>
                <TableWrap className="mt-2">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Order</TH>
                        <TH>Restaurant</TH>
                        <TH>Status</TH>
                        <THNum>Subtotal</THNum>
                      </TR>
                    </THead>
                    <TBody>
                      {order.siblings.map((s) => (
                        <TR key={s.id}>
                          <TD>
                            <Link href={`/admin/orders/${s.id}`} className="font-mono text-xs hover:underline">
                              {shortId(s.id)}
                            </Link>
                          </TD>
                          <TD>{s.restaurantName}</TD>
                          <TD>
                            <Badge tone={orderStatusTone(s.status)}>{orderStatusLabel(s.status)}</Badge>
                          </TD>
                          <TDNum>{paiseToRupeesDisplay(s.subtotalPaise)}</TDNum>
                        </TR>
                      ))}
                      <TR className="bg-cream-100 font-semibold">
                        <TD className="text-ink">Group total</TD>
                        <TD />
                        <TD />
                        <TDNum>{paiseToRupeesDisplay(groupTotal)}</TDNum>
                      </TR>
                    </TBody>
                  </Table>
                </TableWrap>
                {groupTotal !== order.payment.amountPaise ? (
                  <p className="mt-3 rounded-brand bg-warning-bg px-3 py-2 text-xs text-warning">
                    Group subtotals ({paiseToRupeesDisplay(groupTotal)}) do not match the captured payment (
                    {paiseToRupeesDisplay(order.payment.amountPaise)}). This is the §T reconciliation signal — check
                    for a partial refund or a cancelled sibling before treating it as a discrepancy.
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <EmptyState
            title="No payment recorded"
            hint="Expected for an order that never reached checkout. If this order is paid, the payment row is missing and reconciliation will flag it."
          />
        )}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <SectionHeading title="Refunds" description="Additive ledger rows — the original sale is never edited." />
          {order.refunds.length === 0 ? (
            <p className="text-sm text-ink-muted">No refunds against this order.</p>
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Recorded</TH>
                    <TH>Status</TH>
                    <TH>Razorpay refund</TH>
                    <TH>Ticket</TH>
                    <THNum>Amount</THNum>
                  </TR>
                </THead>
                <TBody>
                  {order.refunds.map((r) => (
                    <TR key={r.id}>
                      <TD className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</TD>
                      <TD>{humanise(r.status)}</TD>
                      <TD className="font-mono text-[11px]">{r.razorpayRefundId ?? "—"}</TD>
                      <TD>
                        {r.grievanceTicketId ? (
                          <Link href={`/admin/grievances/${r.grievanceTicketId}`} className="hover:underline">
                            {shortId(r.grievanceTicketId)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </TD>
                      <TDNum>{paiseToRupeesDisplay(r.amountPaise)}</TDNum>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>

        <Card>
          <SectionHeading title="Grievances" description="Every refund path starts from one of these (SRS §16)." />
          {order.grievances.length === 0 ? (
            <p className="text-sm text-ink-muted">No tickets raised against this order.</p>
          ) : (
            <ul className="space-y-2">
              {order.grievances.map((g) => (
                <li key={g.id}>
                  <Link
                    href={`/admin/grievances/${g.id}`}
                    className="flex flex-wrap items-center gap-2 rounded-brand border border-cream-300 px-3 py-2 text-sm hover:bg-cream-100"
                  >
                    <span className="font-semibold text-ink">
                      {g.ticketNo === null ? shortId(g.id) : `#${g.ticketNo}`}
                    </span>
                    <span className="text-ink-soft">{humanise(g.category)}</span>
                    <Badge tone={grievanceStatusTone(g.status)}>{humanise(g.status)}</Badge>
                    <Badge tone={grievancePriorityTone(g.priority)}>{humanise(g.priority)}</Badge>
                    <span className="ml-auto text-xs text-ink-muted">{fmtDateTime(g.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <SectionHeading
          title="Audit trail"
          description="Privileged actions taken against this order. Append-only (SRS §18)."
        />
        {order.auditTrail.length === 0 ? (
          <p className="text-sm text-ink-muted">No administrative actions recorded against this order.</p>
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Action</TH>
                  <TH>Actor role</TH>
                </TR>
              </THead>
              <TBody>
                {order.auditTrail.map((a) => (
                  <TR key={a.id}>
                    <TD className="whitespace-nowrap">{fmtDateTime(a.createdAt)}</TD>
                    <TD className="font-mono text-[11px] text-ink">{a.action}</TD>
                    <TD>{humanise(a.actorRole)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
  mono,
}: {
  label: string;
  value: string;
  tone?: "danger";
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd
        className={[
          "text-right text-sm font-medium",
          tone === "danger" ? "text-danger" : "text-ink",
          mono ? "font-mono text-[11px]" : "",
        ].join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}
