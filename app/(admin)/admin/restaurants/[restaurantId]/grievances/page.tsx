import Link from "next/link";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { listAdminGrievances } from "@/lib/data/admin-grievances";
import { fmtDateTime, fmtRelative, fmtCount, humanise, shortId, TIMEZONE_NOTE } from "@/lib/admin/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Badge, grievanceStatusTone, grievancePriorityTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

/**
 * Restaurant workspace grievances (SRS §16 grievance CRM, §5.3 SUPPORT).
 *
 * The same rows the central inbox shows, narrowed to this restaurant by
 * `listAdminGrievances({ restaurantId })`. The filter is in the reader rather than
 * in this page because filtering here would mean fetching every ticket on the
 * platform in order to display five.
 *
 * Tickets are LISTED here but worked in `/admin/grievances/[id]`. A workspace-local
 * detail page would need its own copy of the reply, status and SLA machinery, and
 * two places to reply to one ticket is how a customer gets answered twice.
 *
 * Rows include tickets raised BY this vendor as well as tickets raised about them —
 * `requesterRole` distinguishes the two. Separating them into two tables was
 * rejected: an operator opening this page is asking "what is unresolved here", and
 * the answer does not depend on who typed it.
 */

export const dynamic = "force-dynamic";

// Defined by exclusion rather than by listing the live statuses. `open`,
// `in_review`, `waiting_customer`, `waiting_vendor` and `escalated` all mean the
// ticket is still someone's problem, and a status added to the enum later should
// default to counting as open rather than silently vanishing from the tile.
const SETTLED_STATUSES = new Set(["resolved", "closed"]);

export default async function RestaurantGrievancesPage({ params }: { params: { restaurantId: string } }) {
  await requireSuperAdmin();
  const { restaurantId } = params;

  const tickets = await listAdminGrievances({ restaurantId });

  const open = tickets.filter((t) => !SETTLED_STATUSES.has(t.status));
  const urgent = open.filter((t) => t.priority === "urgent" || t.priority === "high").length;
  const fromVendor = tickets.filter((t) => t.requesterRole === "vendor").length;

  return (
    <div>
      <PageHeader
        title="Grievances"
        description={`Every ticket attached to this restaurant, whether raised by a customer about it or by the vendor themselves. Replies and status changes happen on the ticket. ${TIMEZONE_NOTE}.`}
      />

      <StatGrid className="lg:grid-cols-4">
        <Stat
          label="Open"
          value={fmtCount(open.length)}
          hint="Not yet resolved or closed"
          tone={open.length > 0 ? "warning" : "success"}
        />
        <Stat
          label="High or urgent"
          value={fmtCount(urgent)}
          hint="Of the open tickets"
          tone={urgent > 0 ? "danger" : "default"}
        />
        <Stat label="Raised by this vendor" value={fmtCount(fromVendor)} hint="Payout and platform complaints" />
        <Stat label="Total ever" value={fmtCount(tickets.length)} hint="Tickets are never deleted" />
      </StatGrid>

      {tickets.length === 0 ? (
        <EmptyState
          className="mt-4"
          title="No grievances for this restaurant"
          hint="Tickets appear here whether a customer raises one about an order or the vendor raises one about a payout."
        />
      ) : (
        <Card className="mt-4">
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Ticket</TH>
                  <TH>Raised</TH>
                  <TH>By</TH>
                  <TH>Category</TH>
                  <TH>Priority</TH>
                  <TH>Status</TH>
                  <TH>Last activity</TH>
                </TR>
              </THead>
              <TBody>
                {tickets.map((t) => (
                  <TR key={t.id} className="hover:bg-cream-100">
                    <TD>
                      <Link
                        href={`/admin/grievances/${t.id}`}
                        className="font-mono text-xs font-semibold text-ink hover:underline"
                      >
                        {shortId(t.id)}
                      </Link>
                    </TD>
                    <TD className="whitespace-nowrap">{fmtDateTime(t.createdAt)}</TD>
                    <TD>
                      <span className="block">{t.requesterName ?? "Unknown"}</span>
                      <span className="block text-[11px] uppercase tracking-wide text-ink-muted">
                        {humanise(t.requesterRole)}
                      </span>
                    </TD>
                    <TD>{humanise(t.category)}</TD>
                    <TD>
                      <Badge tone={grievancePriorityTone(t.priority)}>{humanise(t.priority)}</Badge>
                    </TD>
                    <TD>
                      <Badge tone={grievanceStatusTone(t.status)}>{humanise(t.status)}</Badge>
                    </TD>
                    <TD className="whitespace-nowrap">{fmtRelative(t.updatedAt)}</TD>
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
