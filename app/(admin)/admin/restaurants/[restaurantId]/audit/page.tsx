import { requireSuperAdmin } from "@/lib/auth/guards";
import { listRestaurantAuditLog } from "@/lib/admin/restaurant-workspace";
import { fmtDateTime, shortId, fmtCount, TIMEZONE_NOTE } from "@/lib/admin/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Pagination, parsePage } from "@/components/ui/pagination";

/**
 * Restaurant workspace audit log (SRS §18 audit trail, §P immutable history).
 *
 * Append-only, and there is no code path anywhere in this repository that updates
 * or deletes an `audit_logs` row. That is the property that makes this page worth
 * reading at all: a log an operator can edit answers no question six months later.
 *
 * The rows come from `audit_logs.restaurant_id`, which is denormalised for exactly
 * this view — the alternative is a union over every target table, which would
 * silently miss any table added later. Everything that writes here goes through
 * `recordAuditEvent`, so completeness is a property of one function rather than of
 * every call site remembering.
 *
 * The action filter is a PREFIX match, and the dropdown offers families rather
 * than individual actions: `restaurant.` finds every lifecycle event including
 * ones added after this page was written. A dropdown enumerating exact action
 * names would go stale the first time someone adds a transition.
 *
 * `before`/`after` payloads are stored on each row but not rendered. They are
 * arbitrary JSON of differing shape per action, and a column of raw objects is
 * unreadable at a glance; the reason column carries what the operator typed,
 * which is the part written for a human. The full payload is reachable through
 * the global audit viewer.
 */

export const dynamic = "force-dynamic";

/**
 * Prefix families, transcribed from the action strings the write paths actually
 * emit rather than invented for this dropdown. The value is the prefix handed to
 * the reader's `ilike`, so a family automatically covers actions added to it
 * later — `restaurant.` already picks up hours, exceptions and capacity overrides
 * as well as the four §60 states, because those all write `restaurant.*`.
 *
 * Categories appear twice on purpose. This console writes `category.hidden`,
 * while the vendor app writes `product_category.visibility_changed` — two
 * vocabularies for one table, and a prefix filter cannot match both. Collapsing
 * them into one label would silently drop half the history, so the seam is shown
 * rather than hidden.
 */
const ACTION_FAMILIES: { value: string; label: string }[] = [
  { value: "restaurant.", label: "Restaurant state, settings & pickup hours" },
  { value: "vendor_admin.", label: "Vendor admin access" },
  { value: "staff.", label: "Staff accounts & access" },
  { value: "profile.", label: "Platform account enabled / disabled" },
  { value: "product.", label: "Products" },
  { value: "category.", label: "Categories (changed in this console)" },
  { value: "product_category.", label: "Categories (changed by the vendor)" },
  { value: "order.", label: "Orders" },
  { value: "payment.", label: "Payment capture & mismatches" },
  { value: "refund.", label: "Refunds" },
  { value: "disbursement.", label: "Disbursements" },
  { value: "commission_rate.", label: "Commission rate" },
  { value: "grievance.", label: "Grievances" },
  { value: "walking_time.", label: "Walking times" },
];

type Query = { action?: string; custom?: string; page?: string };

export default async function RestaurantAuditPage({
  params,
  searchParams,
}: {
  params: { restaurantId: string };
  searchParams: Query;
}) {
  await requireSuperAdmin();
  const { restaurantId } = params;
  const basePath = `/admin/restaurants/${restaurantId}/audit`;

  // A typed prefix wins over the dropdown, because someone who typed something
  // specific meant it. Both are carried in the URL so the view stays shareable.
  const custom = searchParams.custom?.trim() || undefined;
  const family = searchParams.action?.trim() || undefined;
  const action = custom ?? family;

  const result = await listRestaurantAuditLog(restaurantId, {
    page: parsePage(searchParams.page),
    action,
  });

  const carried: Record<string, string | undefined> = {
    action: searchParams.action,
    custom: searchParams.custom,
  };

  return (
    <div>
      <PageHeader
        title="Audit Log"
        description={`Every recorded change affecting this restaurant, newest first. Append-only — nothing on this page can be edited or removed, including by a super admin. ${TIMEZONE_NOTE}.`}
      />

      <Card>
        <form method="get" action={basePath} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Action family" htmlFor="action" hint="Matches by prefix, so a family covers new actions too">
            <Select id="action" name="action" defaultValue={searchParams.action ?? ""}>
              <option value="">Everything</option>
              {ACTION_FAMILIES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Exact prefix"
            htmlFor="custom"
            hint="Overrides the dropdown. e.g. restaurant.paused"
          >
            <Input id="custom" name="custom" defaultValue={searchParams.custom ?? ""} placeholder="restaurant.paused" />
          </Field>

          <div className="flex items-end gap-2">
            <Button type="submit">Apply</Button>
            <ButtonLink href={basePath} variant="ghost">
              Reset
            </ButtonLink>
          </div>
        </form>

        {action ? (
          <p className="mt-3 text-xs text-ink-muted">
            Showing actions beginning <span className="font-mono text-ink">{action}</span> —{" "}
            {fmtCount(result.total)} entr{result.total === 1 ? "y" : "ies"}.
          </p>
        ) : null}
      </Card>

      {result.rows.length === 0 ? (
        <EmptyState
          className="mt-4"
          title={action ? "No entries match that prefix" : "Nothing recorded yet"}
          hint={
            action
              ? "The filter is a prefix match on the action name, not a search across reasons. Clear it to see everything."
              : "Entries appear as soon as someone changes something here — settings, access, prices, payouts or state."
          }
        />
      ) : (
        <>
          <TableWrap className="mt-4">
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Action</TH>
                  <TH>By</TH>
                  <TH>Target</TH>
                  <TH>Reason given</TH>
                </TR>
              </THead>
              <TBody>
                {result.rows.map((row) => (
                  <TR key={row.id} className="hover:bg-cream-100">
                    <TD className="whitespace-nowrap">{fmtDateTime(row.createdAt)}</TD>
                    <TD>
                      <span className="font-mono text-xs font-semibold text-ink">{row.action}</span>
                    </TD>
                    <TD>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>{row.actorName ?? "System"}</span>
                        {row.actorRole ? <Badge tone="neutral">{row.actorRole}</Badge> : null}
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap text-xs text-ink-soft">
                      {row.targetTable ?? "—"}
                      {row.targetId ? (
                        <span className="ml-1.5 font-mono text-ink-muted">{shortId(row.targetId)}</span>
                      ) : null}
                    </TD>
                    <TD className="max-w-md">
                      {row.reason?.trim() ? (
                        row.reason
                      ) : (
                        <span className="text-ink-muted">Not required for this action</span>
                      )}
                    </TD>
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

      <Card className="mt-4">
        <p className="text-xs text-ink-soft">
          An entry with no actor is a system action — a timed pause elapsing, or a scheduled job. An entry with no
          reason is one where a reason is not required: reasons are demanded for the changes that take something away
          (pausing, closing, revoking access, disabling an account), because those are the ones someone asks about
          later.
        </p>
      </Card>
    </div>
  );
}
