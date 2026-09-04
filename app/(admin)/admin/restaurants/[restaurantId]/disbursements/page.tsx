import Link from "next/link";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { getVendorPayableSummary, listVendorDisbursements } from "@/lib/data/vendor-payments";
import { paiseToRupeesDisplay } from "@/lib/money";
import { fmtDateTime, fmtCount, TIMEZONE_NOTE } from "@/lib/admin/format";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Badge, disbursementStatusTone } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap, Table, THead, TBody, TR, TH, THNum, TD, TDNum } from "@/components/ui/table";
import { DisburseForm } from "@/components/admin/disburse-form";

/**
 * Restaurant workspace disbursements (SRS §12 payouts, §13 vendor acknowledgement).
 *
 * The ledger of money actually sent, and the form that sends more. It is the write
 * side of Payables, which is read-only.
 *
 * A disbursement is never edited or deleted. A wrong amount is corrected by a
 * further disbursement, because §P and §14 require the payout history to reconcile
 * against the bank record — and a mutable ledger reconciles against nothing.
 *
 * `acknowledged_not_received` is the row that matters most on this page: the vendor
 * has said the money did not arrive. It is styled as a failure and links to the
 * grievance it opened, because a transfer the platform believes it made and the
 * vendor did not receive is the single most expensive disagreement in the system.
 *
 * The disburse form's over-disbursement guard and oldest-first allocation live in
 * `lib/actions/admin/disburse.ts`. This page shows the outstanding figure but does
 * not enforce the ceiling — the action does, so two operators cannot both pass a
 * page-level check and double-pay.
 */

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  paid: "Sent — awaiting vendor confirmation",
  acknowledged_received: "Vendor confirmed received",
  acknowledged_not_received: "Vendor reported NOT received",
};

export default async function RestaurantDisbursementsPage({ params }: { params: { restaurantId: string } }) {
  await requireSuperAdmin();
  const { restaurantId } = params;

  const [summary, disbursements] = await Promise.all([
    getVendorPayableSummary(restaurantId),
    listVendorDisbursements(restaurantId),
  ]);

  const disputed = disbursements.filter((d) => d.status === "acknowledged_not_received").length;
  const awaiting = disbursements.filter((d) => d.status === "paid" || d.status === "pending").length;

  return (
    <div>
      <PageHeader
        title="Disbursements"
        description={`Every payout recorded for this restaurant, and the form to record another. Nothing here is editable — a mistake is corrected by a further disbursement, never by changing one. ${TIMEZONE_NOTE}.`}
        actions={
          <ButtonLink href={`/admin/restaurants/${restaurantId}/payments`} variant="secondary">
            Payables
          </ButtonLink>
        }
      />

      <StatGrid className="lg:grid-cols-4">
        <Stat
          label="Outstanding"
          value={paiseToRupeesDisplay(summary.outstandingPaise)}
          hint="Ceiling for the next disbursement"
          tone={summary.outstandingPaise > 0 ? "warning" : "success"}
        />
        <Stat label="Disbursed to date" value={paiseToRupeesDisplay(summary.disbursedPaise)} hint="Sum of every row below" />
        <Stat
          label="Awaiting confirmation"
          value={fmtCount(awaiting)}
          hint="Sent but not yet acknowledged by the vendor"
        />
        <Stat
          label="Reported not received"
          value={fmtCount(disputed)}
          hint="Vendor disputes the transfer arrived"
          tone={disputed > 0 ? "danger" : "default"}
        />
      </StatGrid>

      <Card className="mt-4">
        <SectionHeading
          title="Record a disbursement"
          description="The amount is allocated to outstanding orders oldest first, so a partial payment settles whole orders in the order they were placed. Proof of transfer is required — §12 makes the vendor's ability to verify a payout part of the payout."
        />
        <DisburseForm restaurantId={restaurantId} outstandingRupees={paiseToRupeesDisplay(summary.outstandingPaise)} />
      </Card>

      <Card className="mt-4">
        <SectionHeading
          title="History"
          description="Newest first. The order count is how many payable rows this transfer covered, which is why it can exceed the number of orders placed that day."
        />
        {disbursements.length === 0 ? (
          <EmptyState
            title="No disbursements recorded"
            hint="Until one exists, the whole net payable is outstanding. That is the normal state for a restaurant that has just started trading."
          />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Recorded</TH>
                  <THNum>Amount</THNum>
                  <TH>Status</TH>
                  <TH>Acknowledged</TH>
                  <THNum>Orders covered</THNum>
                  <TH>Reference</TH>
                  <TH>Proof</TH>
                </TR>
              </THead>
              <TBody>
                {disbursements.map((d) => (
                  <TR key={d.id} className="hover:bg-cream-100">
                    <TD className="whitespace-nowrap">{fmtDateTime(d.createdAt)}</TD>
                    <TDNum className="font-semibold">{paiseToRupeesDisplay(d.amountPaise)}</TDNum>
                    <TD>
                      <Badge tone={disbursementStatusTone(d.status)}>{STATUS_LABEL[d.status] ?? d.status}</Badge>
                      {d.escalatedTicketId ? (
                        <Link
                          href={`/admin/grievances/${d.escalatedTicketId}`}
                          className="mt-1 block text-[11px] font-semibold text-danger hover:underline"
                        >
                          View dispute
                        </Link>
                      ) : null}
                    </TD>
                    <TD className="whitespace-nowrap">{d.acknowledgedAt ? fmtDateTime(d.acknowledgedAt) : "—"}</TD>
                    <TDNum>{fmtCount(d.coversOrderCount)}</TDNum>
                    <TD className="font-mono text-xs">{d.reference ?? "—"}</TD>
                    <TD>
                      {d.proofUrl ? (
                        <a
                          href={d.proofUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-maroon-500 hover:underline"
                        >
                          View proof
                        </a>
                      ) : (
                        <span className="text-xs text-ink-muted">Unavailable</span>
                      )}
                    </TD>
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
