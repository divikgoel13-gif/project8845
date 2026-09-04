import Link from "next/link";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { listGlobalAuditLog, findActorIdsByName } from "@/lib/admin/audit";
import { listRestaurantOptions } from "@/lib/admin/restaurants";
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
 * Global Audit Log (SRS §16/§18, Phase 9). See lib/admin/audit.ts for why
 * this reads the exact same `audit_logs` table the restaurant workspace's
 * own Audit Log page reads, rather than a second system — this is the
 * "global audit viewer" that page's own doc comment already promises.
 *
 * Fraud review (SRS §S) is reached from here rather than getting its own
 * top-level sidebar slot — both are CONTROL-group oversight surfaces, and
 * `lib/fraud/flags.ts`'s own comment already names `/admin/fraud` as the
 * review queue's route.
 */

export const dynamic = "force-dynamic";

/**
 * Prefix families. Transcribed from the action strings actually emitted
 * across every phase's write paths, extending the restaurant-scoped page's
 * own list with the platform-wide-only prefixes Phase 9 introduced
 * (analytics exports, feature flags, maintenance, settings, notification
 * templates, announcements, data retention). A family automatically covers
 * new actions added to it later, since the match is by prefix.
 */
const ACTION_FAMILIES: { value: string; label: string }[] = [
  { value: "restaurant.", label: "Restaurant state, settings & pickup hours" },
  { value: "vendor_admin.", label: "Vendor admin access" },
  { value: "staff.", label: "Staff accounts & access" },
  { value: "profile.", label: "Platform accounts (enable/disable, force logout)" },
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
  { value: "analytics.", label: "Analytics exports" },
  { value: "feature_flag.", label: "Feature flags" },
  { value: "maintenance_mode.", label: "Maintenance mode" },
  { value: "admin_setting.", label: "Operational settings" },
  { value: "notification_template.", label: "Notification templates" },
  { value: "announcement.", label: "Announcements" },
  { value: "data_retention_policy.", label: "Data retention policy" },
  { value: "reconciliation_item.", label: "Financial reconciliation" },
  { value: "fraud_flag.", label: "Fraud & abuse flags" },
];

type Query = { action?: string; custom?: string; actor?: string; restaurant?: string; page?: string };

export default async function GlobalAuditLogPage({ searchParams }: { searchParams: Query }) {
  await requireSuperAdmin();

  const custom = searchParams.custom?.trim() || undefined;
  const family = searchParams.action?.trim() || undefined;
  const action = custom ?? family;
  const actorSearch = searchParams.actor?.trim() || undefined;
  const restaurantId = searchParams.restaurant?.trim() || undefined;

  const [actorIds, restaurantOptions] = await Promise.all([
    actorSearch ? findActorIdsByName(actorSearch) : Promise.resolve(undefined),
    listRestaurantOptions(),
  ]);

  const noActorMatch = actorSearch !== undefined && actorIds !== undefined && actorIds.length === 0;

  const result = noActorMatch
    ? { rows: [], total: 0, page: 1, pageSize: 1 }
    : await listGlobalAuditLog({
        page: parsePage(searchParams.page),
        action,
        actorIds,
        restaurantId,
      });

  const carried: Record<string, string | undefined> = {
    action: searchParams.action,
    custom: searchParams.custom,
    actor: searchParams.actor,
    restaurant: searchParams.restaurant,
  };

  return (
    <div>
      <PageHeader
        title="Audit Log"
        description={`Every recorded privileged action across the whole platform, newest first. Append-only — nothing here can be edited or removed, including by a super admin. ${TIMEZONE_NOTE}.`}
        actions={
          <Link
            href="/admin/audit/fraud"
            className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm font-semibold text-ink hover:bg-cream-200"
          >
            Fraud review
          </Link>
        }
      />

      <Card>
        <form method="get" action="/admin/audit" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

          <Field label="Exact prefix" htmlFor="custom" hint="Overrides the dropdown. e.g. restaurant.paused">
            <Input id="custom" name="custom" defaultValue={searchParams.custom ?? ""} placeholder="restaurant.paused" />
          </Field>

          <Field label="Actor" htmlFor="actor" hint="Matches by name">
            <Input id="actor" name="actor" defaultValue={searchParams.actor ?? ""} placeholder="Name" />
          </Field>

          <Field label="Restaurant" htmlFor="restaurant" hint="Leave blank for platform-wide">
            <Select id="restaurant" name="restaurant" defaultValue={restaurantId ?? ""}>
              <option value="">All restaurants</option>
              {restaurantOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="submit">Apply</Button>
            <ButtonLink href="/admin/audit" variant="ghost">
              Reset
            </ButtonLink>
          </div>
        </form>

        {action || actorSearch || restaurantId ? (
          <p className="mt-3 text-xs text-ink-muted">
            {fmtCount(result.total)} entr{result.total === 1 ? "y" : "ies"} match
            {action ? (
              <>
                {" "}
                action prefix <span className="font-mono text-ink">{action}</span>
              </>
            ) : null}
          </p>
        ) : null}
      </Card>

      {noActorMatch ? (
        <EmptyState className="mt-4" title="No accounts match that name" hint="Try a shorter or differently spelled search term." />
      ) : result.rows.length === 0 ? (
        <EmptyState
          className="mt-4"
          title={action ? "No entries match that prefix" : "Nothing recorded yet"}
          hint="Try clearing a filter — the action prefix, actor and restaurant filters all narrow independently."
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
                  <TH>Restaurant</TH>
                  <TH>Target</TH>
                  <TH>Reason given</TH>
                  <TH aria-label="Details" />
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
                      {row.restaurantName ? (
                        <Link href={`/admin/restaurants/${row.restaurantId}/dashboard`} className="hover:underline">
                          {row.restaurantName}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-xs text-ink-soft">
                      {row.targetTable ?? "—"}
                      {row.targetId ? <span className="ml-1.5 font-mono text-ink-muted">{shortId(row.targetId)}</span> : null}
                    </TD>
                    <TD className="max-w-xs">
                      {row.reason?.trim() ? row.reason : <span className="text-ink-muted">Not required for this action</span>}
                    </TD>
                    <TD>
                      {row.before || row.after ? (
                        <details>
                          <summary className="cursor-pointer text-xs font-semibold text-ink-soft">View</summary>
                          <div className="mt-2 flex max-w-sm flex-col gap-2 text-[11px]">
                            {row.before ? (
                              <div>
                                <p className="font-semibold text-ink-muted">Before</p>
                                <pre className="overflow-x-auto rounded-brand bg-cream-100 p-2">
                                  {JSON.stringify(row.before, null, 2)}
                                </pre>
                              </div>
                            ) : null}
                            {row.after ? (
                              <div>
                                <p className="font-semibold text-ink-muted">After</p>
                                <pre className="overflow-x-auto rounded-brand bg-cream-100 p-2">
                                  {JSON.stringify(row.after, null, 2)}
                                </pre>
                              </div>
                            ) : null}
                          </div>
                        </details>
                      ) : (
                        <span className="text-xs text-ink-muted">—</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>

          <Pagination className="mt-4" page={result.page} pageSize={result.pageSize} total={result.total} basePath="/admin/audit" params={carried} />
        </>
      )}

      <Card className="mt-4">
        <p className="text-xs text-ink-soft">
          An entry with no actor is a system action — a timed pause elapsing, or a scheduled job. An entry with no
          reason is one where a reason is not required: reasons are demanded for the changes that take something
          away (pausing, closing, revoking access, disabling an account, changing platform behaviour), because
          those are the ones someone asks about later. This page is read-only — nothing here can be edited or
          reversed from this screen.
        </p>
      </Card>
    </div>
  );
}
