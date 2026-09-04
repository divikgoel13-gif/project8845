import Link from "next/link";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { listRestaurantRatings } from "@/lib/admin/restaurant-workspace";
import { fmtDateTime, fmtCount, shortId, TIMEZONE_NOTE } from "@/lib/admin/format";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap, Table, THead, TBody, TR, TH, THNum, TD, TDNum } from "@/components/ui/table";

/**
 * Restaurant workspace ratings (SRS §10 ratings, §5.3 SUPPORT).
 *
 * Read-only, and deliberately so. There is no "hide this review" control: a rating
 * belongs to the customer who left it, and a platform that can quietly delete the
 * ones it dislikes has an average that means nothing. A review that breaks the rules
 * is a grievance — handled on the ticket, with a record — not a row this page erases.
 *
 * The average shown is over EVERY rating, not the hundred rows below it. A
 * page-local average changes when you paginate, which is worse than no average at
 * all when a vendor is disputing their score.
 *
 * Stars are rendered as a number with the word, not as glyphs. §30 forbids emoji
 * platform-wide, and a row of repeated characters is also unreadable to a screen
 * reader.
 */

export const dynamic = "force-dynamic";

export default async function RestaurantRatingsPage({ params }: { params: { restaurantId: string } }) {
  await requireSuperAdmin();
  const { restaurantId } = params;

  const { rows, summary } = await listRestaurantRatings(restaurantId);

  // Share of the whole rating set, so the bar lengths do not change when the row
  // limit does.
  const share = (count: number) => (summary.count === 0 ? 0 : Math.round((count / summary.count) * 100));
  const lowStars = summary.distribution[0] + summary.distribution[1];

  return (
    <div>
      <PageHeader
        title="Ratings"
        description={`What customers have said about this restaurant. Read-only: ratings are the customer's, and an abusive one is handled as a grievance rather than deleted. ${TIMEZONE_NOTE}.`}
      />

      <StatGrid className="lg:grid-cols-4">
        <Stat
          label="Average"
          value={summary.averageStars === null ? "—" : `${summary.averageStars} of 5`}
          hint="Across every rating ever left, not the page below"
        />
        <Stat label="Ratings" value={fmtCount(summary.count)} hint="One per collected order at most" />
        <Stat
          label="One or two stars"
          value={fmtCount(lowStars)}
          hint="Worth reading before a vendor conversation"
          tone={lowStars > 0 ? "warning" : "default"}
        />
        <Stat label="With a comment" value={fmtCount(summary.withComments)} hint="The rest are a score only" />
      </StatGrid>

      {summary.count === 0 ? (
        <EmptyState
          className="mt-4"
          title="No ratings yet"
          hint="A customer can rate an order once it has been collected, so a restaurant that has just opened has none."
        />
      ) : (
        <>
          <Card className="mt-4">
            <SectionHeading
              title="Distribution"
              description="Counts across every rating. An average alone hides a restaurant that is either excellent or terrible with nothing in between."
            />
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Score</TH>
                    <THNum>Ratings</THNum>
                    <THNum>Share</THNum>
                    <TH aria-label="Proportion" />
                  </TR>
                </THead>
                <TBody>
                  {([5, 4, 3, 2, 1] as const).map((stars) => {
                    // summary.distribution is a fixed 5-tuple indexed 0..4 for
                    // 1..5 stars; the literal `stars` values above guarantee
                    // stars - 1 is always a valid tuple index.
                    const count = summary.distribution[(stars - 1) as 0 | 1 | 2 | 3 | 4];
                    return (
                      <TR key={stars}>
                        <TD>
                          {stars} star{stars === 1 ? "" : "s"}
                        </TD>
                        <TDNum>{fmtCount(count)}</TDNum>
                        <TDNum>{share(count)}%</TDNum>
                        <TD>
                          <div className="h-2 w-full max-w-xs rounded-brand bg-cream-200" aria-hidden="true">
                            <div
                              className="h-2 rounded-brand bg-orange-400"
                              style={{ width: `${share(count)}%` }}
                            />
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrap>
          </Card>

          <Card className="mt-4">
            <SectionHeading
              title="Most recent"
              description="Newest first, capped at one hundred. Each links to the order it rates, because a complaint about cold food is only actionable next to what was ordered and when it was collected."
            />
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Left</TH>
                    <TH>Customer</TH>
                    <THNum>Score</THNum>
                    <TH>Comment</TH>
                    <TH>Order</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((r) => (
                    <TR key={r.id} className="hover:bg-cream-100">
                      <TD className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</TD>
                      <TD>{r.customerName ?? "Unknown"}</TD>
                      <TDNum>{r.stars}</TDNum>
                      <TD className="max-w-md">{r.comment?.trim() ? r.comment : <span className="text-ink-muted">No comment</span>}</TD>
                      <TD>
                        <Link
                          href={`/admin/orders/${r.orderId}`}
                          className="font-mono text-xs font-semibold text-ink hover:underline"
                        >
                          {shortId(r.orderId)}
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </Card>
        </>
      )}
    </div>
  );
}
