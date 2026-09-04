import Link from "next/link";

import { requireSuperAdmin } from "@/lib/auth/guards";
import {
  listCustomers,
  type CustomerActivity,
  type CustomerSegment,
  type CustomerSort,
} from "@/lib/admin/customers";
import { paiseToRupeesDisplay } from "@/lib/money";
import { fmtDate, fmtRelative, fmtCount, TIMEZONE_NOTE } from "@/lib/admin/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap, Table, THead, TBody, TR, TH, THNum, TD, TDNum } from "@/components/ui/table";
import { Pagination, parsePage } from "@/components/ui/pagination";

/**
 * Customer directory (SRS §7.1).
 *
 * Every column here except name, contact and join date is an aggregate over
 * another table, and every segment filter is a predicate on one of those
 * aggregates — see the header of `lib/admin/customers.ts` for why that forces the
 * reader to aggregate the whole customer body before paginating rather than the
 * other way round.
 *
 * The consequence for this page is the `truncated` banner. When the scan cap is
 * hit the numbers are a floor rather than a total, and the page says so instead of
 * printing a confident wrong figure.
 *
 * Filters live in the query string, so a segment an operator is working through is
 * a link they can send to somebody else, and "export what I am looking at" is the
 * same query string handed to the CSV route.
 */

export const dynamic = "force-dynamic";

type Query = {
  q?: string;
  segment?: string;
  activity?: string;
  from?: string;
  to?: string;
  sort?: string;
  page?: string;
};

/**
 * The §7.1 filter vocabulary, with labels that say what the filter MEANS rather
 * than naming the column. "Repeat" and "high value" are thresholds, so the label
 * carries the threshold — an operator should not have to read the source to learn
 * that high value starts at ₹5,000.
 */
const SEGMENTS: { value: CustomerSegment; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "new", label: "New — joined in the last 30 days" },
  { value: "repeat", label: "Repeat — 2 or more completed orders" },
  { value: "high_value", label: "High value — ₹5,000+ lifetime" },
  { value: "open_grievance", label: "Has an open support issue" },
  { value: "payment_issue", label: "Has had payment trouble" },
  { value: "cancellations", label: "Frequent cancellations" },
  { value: "no_shows", label: "Repeated no-shows" },
  { value: "manually_flagged", label: "Manually flagged by an admin" },
  { value: "inactive", label: "Account disabled" },
  { value: "active", label: "Account active" },
];

const ACTIVITIES: { value: CustomerActivity; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "7d", label: "Ordered in the last 7 days" },
  { value: "30d", label: "Ordered in the last 30 days" },
  { value: "90d", label: "Ordered in the last 90 days" },
  { value: "dormant", label: "Dormant — nothing for 90 days" },
  { value: "never", label: "Never ordered" },
];

const SORTS: { value: CustomerSort; label: string }[] = [
  { value: "joined", label: "Newest account first" },
  { value: "spend", label: "Highest lifetime spend" },
  { value: "orders", label: "Most orders" },
  { value: "last_order", label: "Most recently active" },
  { value: "issues", label: "Most open issues" },
  { value: "name", label: "Name (A–Z)" },
];

function pick<T extends string>(raw: string | undefined, allowed: readonly { value: T }[]): T | undefined {
  return raw && allowed.some((a) => a.value === raw) ? (raw as T) : undefined;
}

function parseDate(raw: string | undefined): string | undefined {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

export default async function AdminCustomersPage({ searchParams }: { searchParams: Query }) {
  await requireSuperAdmin();
  const basePath = "/admin/customers";

  const filters = {
    search: searchParams.q?.trim() || undefined,
    segment: pick<CustomerSegment>(searchParams.segment, SEGMENTS),
    activity: pick<CustomerActivity>(searchParams.activity, ACTIVITIES),
    joinedFrom: parseDate(searchParams.from),
    joinedTo: parseDate(searchParams.to),
    sort: pick<CustomerSort>(searchParams.sort, SORTS),
    page: parsePage(searchParams.page),
  };

  const result = await listCustomers(filters);

  const carried: Record<string, string | undefined> = {
    q: searchParams.q,
    segment: searchParams.segment,
    activity: searchParams.activity,
    from: searchParams.from,
    to: searchParams.to,
    sort: searchParams.sort,
  };

  const exportQs = new URLSearchParams();
  for (const [key, value] of Object.entries(carried)) if (value) exportQs.set(key, value);

  return (
    <div>
      <PageHeader
        title="Customers"
        description={`Internal CRM, not a user table. Every figure is computed from orders, payments, ratings and tickets — customers never see any of it. ${TIMEZONE_NOTE}.`}
        actions={
          <ButtonLink
            href={`/admin/customers/export${exportQs.toString() ? `?${exportQs.toString()}` : ""}`}
            variant="secondary"
          >
            Export CSV
          </ButtonLink>
        }
      />

      <StatGrid className="lg:grid-cols-4">
        <Stat
          label="Customers matched"
          value={fmtCount(result.totals.customers)}
          hint={result.truncated ? "At least — the scan was capped" : "This filter set"}
        />
        <Stat
          label="Lifetime spend"
          value={paiseToRupeesDisplay(result.totals.lifetimeSpendPaise)}
          hint="Completed orders only, gross of commission"
        />
        <Stat
          label="With an open issue"
          value={fmtCount(result.totals.withOpenIssues)}
          tone={result.totals.withOpenIssues > 0 ? "warning" : "default"}
          hint="Someone owes them a reply"
        />
        <Stat
          label="Disabled accounts"
          value={fmtCount(result.totals.disabledAccounts)}
          tone={result.totals.disabledAccounts > 0 ? "danger" : "default"}
          hint="Cannot sign in. History retained."
        />
      </StatGrid>

      {result.truncated ? (
        <Card className="mt-4 border-warning/40 bg-warning-bg">
          <p className="text-xs text-warning">
            This platform now has more history than one page can scan at once. The counts above are a floor, not a
            total, and a customer whose orders fell outside the scan may be missing a badge. Narrow the join-date range
            to get exact figures.
          </p>
        </Card>
      ) : null}

      <Card className="mt-4">
        <form method="get" action={basePath} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Search"
            htmlFor="q"
            hint="Name, email, phone, order id or ticket number"
          >
            <Input id="q" name="q" defaultValue={searchParams.q ?? ""} placeholder="Priya, 98…, 3f2a… or 1042" />
          </Field>

          <Field label="Segment" htmlFor="segment" hint="Thresholds are fixed, so two exports agree">
            <Select id="segment" name="segment" defaultValue={searchParams.segment ?? "all"}>
              {SEGMENTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Last activity" htmlFor="activity" hint="Last order placed, not last sign-in">
            <Select id="activity" name="activity" defaultValue={searchParams.activity ?? "any"}>
              {ACTIVITIES.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Joined from" htmlFor="from" hint="Campus date">
              <Input id="from" type="date" name="from" defaultValue={searchParams.from ?? ""} />
            </Field>
            <Field label="Joined to" htmlFor="to" hint="Campus date">
              <Input id="to" type="date" name="to" defaultValue={searchParams.to ?? ""} />
            </Field>
          </div>

          <Field label="Sort by" htmlFor="sort">
            <Select id="sort" name="sort" defaultValue={searchParams.sort ?? "joined"}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>

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
          title={filters.search ? "Nobody matches that search" : "No customers match these filters"}
          hint={
            filters.search
              ? "The search covers name, email, phone, order id prefix and ticket number. It does not search note or grievance text."
              : "Segments are computed from real activity, so a brand-new platform will show most of them empty."
          }
        />
      ) : (
        <>
          <TableWrap className="mt-4">
            <Table>
              <THead>
                <TR>
                  <TH>Customer</TH>
                  <TH>Contact</TH>
                  <TH>Joined</TH>
                  <TH>Last order</TH>
                  <THNum>Orders</THNum>
                  <THNum>Lifetime</THNum>
                  <THNum>Avg order</THNum>
                  <THNum>Rating</THNum>
                  <TH>Signals</TH>
                </TR>
              </THead>
              <TBody>
                {result.rows.map((c) => (
                  <TR key={c.id} className="hover:bg-cream-100">
                    <TD>
                      <Link href={`/admin/customers/${c.id}`} className="font-semibold text-ink hover:underline">
                        {c.name ?? "Unnamed account"}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {c.accountStatus === "disabled" ? <Badge tone="danger">Disabled</Badge> : null}
                        {c.course ? <span className="text-xs text-ink-muted">{c.course}</span> : null}
                      </div>
                    </TD>
                    <TD className="text-xs text-ink-soft">
                      <div>{c.email ?? "—"}</div>
                      <div className="text-ink-muted">{c.phone ?? "—"}</div>
                    </TD>
                    <TD className="whitespace-nowrap text-xs">{fmtDate(c.joinedAt)}</TD>
                    <TD className="whitespace-nowrap text-xs">
                      {c.lastOrderAt ? fmtRelative(c.lastOrderAt) : <span className="text-ink-muted">Never</span>}
                    </TD>
                    <TDNum>
                      {c.realizedCount}
                      {c.orderCount !== c.realizedCount ? (
                        <span className="ml-1 text-xs text-ink-muted">of {c.orderCount}</span>
                      ) : null}
                    </TDNum>
                    <TDNum>{paiseToRupeesDisplay(c.lifetimeSpendPaise)}</TDNum>
                    <TDNum>
                      {c.averageOrderPaise === null ? "—" : paiseToRupeesDisplay(c.averageOrderPaise)}
                    </TDNum>
                    <TDNum>
                      {c.averageStars === null ? (
                        "—"
                      ) : (
                        <>
                          {c.averageStars.toFixed(1)}
                          <span className="ml-1 text-xs text-ink-muted">({c.ratingCount})</span>
                        </>
                      )}
                    </TDNum>
                    <TD>
                      <div className="flex max-w-[16rem] flex-wrap gap-1">
                        {c.derivedFlags.map((f) => (
                          <Badge key={f.key} tone={f.tone} title={f.detail}>
                            {f.label}
                          </Badge>
                        ))}
                        {c.manualFlags.map((f) => (
                          <Badge key={f} tone="accent" title="Raised manually by an admin">
                            {f}
                          </Badge>
                        ))}
                        {c.derivedFlags.length === 0 && c.manualFlags.length === 0 ? (
                          <span className="text-xs text-ink-muted">None</span>
                        ) : null}
                      </div>
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
          Badges are computed on every read from the customer&apos;s own history, never stored, so they cannot go stale
          and cannot be edited into existence. Hover a badge to see the number behind it. A badge in the last colour is
          a manual flag written by an admin with a stated reason — open the customer to see who raised it and why.
        </p>
      </Card>
    </div>
  );
}
