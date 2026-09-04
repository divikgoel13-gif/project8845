import Link from "next/link";

import { requireSuperAdmin } from "@/lib/auth/guards";
import {
  listGrievances,
  listGrievanceTemplates,
  listRestaurantOptions,
  listSupportAgents,
  type GrievanceCategory,
  type GrievancePriority,
  type GrievanceQueueView,
  type GrievanceRequesterRole,
  type GrievanceSort,
  type GrievanceStatus,
} from "@/lib/admin/grievances";
import { formatSlaRemaining } from "@/lib/grievance/sla";
import { fmtRelative, fmtCount, humanise, shortId, TIMEZONE_NOTE } from "@/lib/admin/format";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Badge, grievanceStatusTone, grievancePriorityTone } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { GrievanceTemplateManager } from "@/components/admin/grievance-workspace-controls";

/**
 * The central grievance queue (SRS §13).
 *
 * §13 asks for one CRM covering both customer and vendor grievances, and the
 * thing that makes such a queue usable is not more columns — it is the saved
 * views. An agent arriving in the morning has one of a small number of
 * questions: what is nobody holding, what is about to breach, what is waiting on
 * me, what did I escalate. Those are the nine `GrievanceQueueView` values, and
 * they are the primary control on this page; the field-by-field filters below
 * exist for the rarer investigative case.
 *
 * SLA highlighting is the other §13 requirement with teeth. A breach is rendered
 * on the row itself (danger badge plus a tinted row) rather than only in a
 * counter, because a number that says "3 breaching" and a list that does not say
 * which three is a worse tool than no number at all.
 *
 * Filters live entirely in the query string. That makes a triage view a link an
 * agent can hand to a colleague, and it lets the CSV route reuse the exact same
 * query string instead of maintaining a second filter UI that can disagree with
 * the table.
 */

export const dynamic = "force-dynamic";

type Query = {
  q?: string;
  view?: string;
  role?: string;
  status?: string;
  category?: string;
  priority?: string;
  assignee?: string;
  restaurant?: string;
  from?: string;
  to?: string;
  sort?: string;
  page?: string;
};

/**
 * The saved views, labelled by the question they answer rather than by the
 * predicate they run. "Waiting on us" is the one an agent should live in.
 */
const VIEWS: { value: GrievanceQueueView; label: string }[] = [
  { value: "waiting_on_us", label: "Waiting on us — we owe a reply" },
  { value: "unresolved", label: "All open tickets" },
  { value: "unassigned", label: "Unassigned — nobody has picked it up" },
  { value: "mine", label: "Assigned to me" },
  { value: "breaching", label: "Breaching or overdue" },
  { value: "waiting_on_them", label: "Waiting on the requester" },
  { value: "escalated", label: "Escalated" },
  { value: "resolved", label: "Resolved and closed" },
  { value: "all", label: "Everything, any status" },
];

/**
 * Only two requester roles exist in the `grievance_role` enum. Staff issues are
 * raised by the vendor admin on a staff member's behalf and carry the
 * `staff_issue` CATEGORY, which is why there is no third option here.
 */
const ROLES: { value: GrievanceRequesterRole; label: string }[] = [
  { value: "customer", label: "Customer" },
  { value: "vendor", label: "Vendor" },
];

const STATUSES: { value: GrievanceStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_review", label: "In review" },
  { value: "waiting_customer", label: "Waiting on customer" },
  { value: "waiting_vendor", label: "Waiting on vendor" },
  { value: "escalated", label: "Escalated" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const CATEGORIES: { value: GrievanceCategory; label: string }[] = [
  { value: "payment", label: "Payment" },
  { value: "refund", label: "Refund" },
  { value: "wrong_item", label: "Wrong item" },
  { value: "missing_item", label: "Missing item" },
  { value: "pickup", label: "Pickup" },
  { value: "qr", label: "QR code" },
  { value: "vendor_issue", label: "Restaurant issue" },
  { value: "staff_issue", label: "Staff issue" },
  { value: "product_issue", label: "Food or product issue" },
  { value: "account", label: "Account" },
  { value: "technical", label: "Technical" },
  { value: "other", label: "Other" },
];

const PRIORITIES: { value: GrievancePriority; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

const SORTS: { value: GrievanceSort; label: string }[] = [
  { value: "sla", label: "Tightest clock first" },
  { value: "updated", label: "Most recently updated" },
  { value: "created", label: "Newest ticket first" },
  { value: "priority", label: "Highest priority first" },
  { value: "ticket", label: "Ticket number" },
];

function pick<T extends string>(raw: string | undefined, allowed: readonly { value: T }[]): T | undefined {
  return raw && allowed.some((a) => a.value === raw) ? (raw as T) : undefined;
}

function parseDate(raw: string | undefined): string | undefined {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

function parseUuid(raw: string | undefined): string | undefined {
  return raw && /^[0-9a-fA-F-]{36}$/.test(raw) ? raw : undefined;
}

export default async function AdminGrievancesPage({ searchParams }: { searchParams: Query }) {
  const admin = await requireSuperAdmin();
  const basePath = "/admin/grievances";

  const view = pick<GrievanceQueueView>(searchParams.view, VIEWS) ?? "waiting_on_us";

  const [result, agents, restaurants, templates] = await Promise.all([
    listGrievances({
      search: searchParams.q?.trim() || undefined,
      view,
      requesterRole: pick<GrievanceRequesterRole>(searchParams.role, ROLES),
      status: pick<GrievanceStatus>(searchParams.status, STATUSES),
      category: pick<GrievanceCategory>(searchParams.category, CATEGORIES),
      priority: pick<GrievancePriority>(searchParams.priority, PRIORITIES),
      assigneeId: parseUuid(searchParams.assignee),
      restaurantId: parseUuid(searchParams.restaurant),
      from: parseDate(searchParams.from),
      to: parseDate(searchParams.to),
      sort: pick<GrievanceSort>(searchParams.sort, SORTS),
      page: parsePage(searchParams.page),
      viewerId: admin.id,
    }),
    listSupportAgents(),
    listRestaurantOptions(),
    listGrievanceTemplates(true),
  ]);

  const carried: Record<string, string | undefined> = {
    q: searchParams.q,
    view: searchParams.view,
    role: searchParams.role,
    status: searchParams.status,
    category: searchParams.category,
    priority: searchParams.priority,
    assignee: searchParams.assignee,
    restaurant: searchParams.restaurant,
    from: searchParams.from,
    to: searchParams.to,
    sort: searchParams.sort,
  };

  const exportQs = new URLSearchParams();
  for (const [key, value] of Object.entries(carried)) if (value) exportQs.set(key, value);

  const viewHref = (target: GrievanceQueueView) => {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries(carried)) {
      if (value && key !== "view") sp.set(key, value);
    }
    if (target !== "waiting_on_us") sp.set("view", target);
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div>
      <PageHeader
        title="Grievances"
        description={`Every ticket raised by a customer or a vendor, in one queue. Customer tickets are visible here and nowhere else — a vendor never sees a complaint about their own restaurant. ${TIMEZONE_NOTE}.`}
        actions={
          <ButtonLink
            href={`/admin/grievances/export${exportQs.toString() ? `?${exportQs.toString()}` : ""}`}
            variant="secondary"
          >
            Export CSV
          </ButtonLink>
        }
      />

      <StatGrid className="lg:grid-cols-5">
        <Stat
          label="Matched"
          value={fmtCount(result.totals.matched)}
          hint={result.truncated ? "At least — the scan was capped" : "This filter set"}
        />
        <Stat
          label="Breaching"
          value={fmtCount(result.totals.breaching)}
          tone={result.totals.breaching > 0 ? "danger" : "success"}
          hint="Past a promised clock"
          href={viewHref("breaching")}
        />
        <Stat
          label="Waiting on us"
          value={fmtCount(result.totals.waitingOnUs)}
          tone={result.totals.waitingOnUs > 0 ? "warning" : "default"}
          hint="The requester spoke last"
          href={viewHref("waiting_on_us")}
        />
        <Stat
          label="Unassigned"
          value={fmtCount(result.totals.unassigned)}
          tone={result.totals.unassigned > 0 ? "warning" : "default"}
          hint="Nobody owns these yet"
          href={viewHref("unassigned")}
        />
        <Stat
          label="No first reply"
          value={fmtCount(result.totals.awaitingFirstResponse)}
          tone={result.totals.awaitingFirstResponse > 0 ? "warning" : "default"}
          hint="Never answered once"
        />
      </StatGrid>

      {result.truncated ? (
        <Card className="mt-4 border-warning/40 bg-warning-bg">
          <p className="text-xs text-warning">
            More tickets match than one scan can read, so the counters above are a floor rather than a total. Narrow the
            date range or pick a single view to get exact figures.
          </p>
        </Card>
      ) : null}

      {/* Saved views: the primary control, and the reason this page is usable. */}
      <div className="mt-4 flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Link
            key={v.value}
            href={viewHref(v.value)}
            className={
              v.value === view
                ? "rounded-brand border border-maroon-500 bg-maroon-500 px-3 py-1.5 text-xs font-semibold text-cream-50"
                : "rounded-brand border border-cream-300 bg-cream-50 px-3 py-1.5 text-xs font-medium text-ink hover:bg-cream-200"
            }
          >
            {v.label}
          </Link>
        ))}
      </div>

      <Card className="mt-4">
        <form method="get" action={basePath} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <input type="hidden" name="view" value={view} />

          <Field label="Search" htmlFor="q" hint="Ticket number, requester name, phone, email or order id">
            <Input id="q" name="q" defaultValue={searchParams.q ?? ""} placeholder="1042, Priya, 98… or 3f2a…" />
          </Field>

          <Field label="Raised by" htmlFor="role">
            <Select id="role" name="role" defaultValue={searchParams.role ?? ""}>
              <option value="">Anyone</option>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Status" htmlFor="status" hint="Narrows within the chosen view">
            <Select id="status" name="status" defaultValue={searchParams.status ?? ""}>
              <option value="">Any status</option>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Category" htmlFor="category">
            <Select id="category" name="category" defaultValue={searchParams.category ?? ""}>
              <option value="">Any category</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Priority" htmlFor="priority">
            <Select id="priority" name="priority" defaultValue={searchParams.priority ?? ""}>
              <option value="">Any priority</option>
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Assigned to" htmlFor="assignee">
            <Select id="assignee" name="assignee" defaultValue={searchParams.assignee ?? ""}>
              <option value="">Anyone</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ?? a.email ?? shortId(a.id)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Restaurant" htmlFor="restaurant" hint="Only tickets linked to one">
            <Select id="restaurant" name="restaurant" defaultValue={searchParams.restaurant ?? ""}>
              <option value="">Any restaurant</option>
              {restaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Raised from" htmlFor="from" hint="Campus date">
              <Input id="from" type="date" name="from" defaultValue={searchParams.from ?? ""} />
            </Field>
            <Field label="Raised to" htmlFor="to" hint="Campus date">
              <Input id="to" type="date" name="to" defaultValue={searchParams.to ?? ""} />
            </Field>
          </div>

          <Field label="Sort by" htmlFor="sort">
            <Select id="sort" name="sort" defaultValue={searchParams.sort ?? "sla"}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex items-end gap-2">
            <Button type="submit">Apply</Button>
            <ButtonLink href={viewHref(view)} variant="ghost">
              Clear filters
            </ButtonLink>
          </div>
        </form>
      </Card>

      {result.rows.length === 0 ? (
        <EmptyState
          className="mt-4"
          title={searchParams.q ? "No ticket matches that search" : "Nothing in this view"}
          hint={
            searchParams.q
              ? "Search covers ticket number, requester name, phone, email and order id. It does not search message text."
              : "An empty “waiting on us” view is the good outcome: every requester has had the last word answered."
          }
        />
      ) : (
        <>
          <TableWrap className="mt-4">
            <Table>
              <THead>
                <TR>
                  <TH>Ticket</TH>
                  <TH>Requester</TH>
                  <TH>About</TH>
                  <TH>Status</TH>
                  <TH>SLA</TH>
                  <TH>Assigned</TH>
                  <TH>Updated</TH>
                </TR>
              </THead>
              <TBody>
                {result.rows.map((t) => {
                  const remaining = formatSlaRemaining(t.sla.minutesRemaining);
                  return (
                    <TR key={t.id} className={t.sla.breached ? "bg-danger-bg/40" : "hover:bg-cream-100"}>
                      <TD>
                        <Link
                          href={`/admin/grievances/${t.id}`}
                          className="font-semibold text-ink hover:underline"
                        >
                          {t.ticketNo ? `#${t.ticketNo}` : shortId(t.id)}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          <Badge tone={grievancePriorityTone(t.priority)}>{humanise(t.priority)}</Badge>
                          {t.escalatedAt ? <Badge tone="danger">Escalated</Badge> : null}
                          {t.reopenedCount > 0 ? (
                            <Badge tone="warning" title={`Reopened ${t.reopenedCount} time(s)`}>
                              Reopened
                            </Badge>
                          ) : null}
                        </div>
                      </TD>
                      <TD className="text-xs">
                        <div className="font-medium text-ink">{t.requesterName ?? "Unnamed account"}</div>
                        <div className="text-ink-muted">
                          {humanise(t.requesterRole)}
                          {t.requesterContact ? ` · ${t.requesterContact}` : ""}
                        </div>
                      </TD>
                      <TD className="text-xs">
                        <div className="text-ink">{humanise(t.category)}</div>
                        <div className="text-ink-muted">
                          {t.restaurantName ?? "No restaurant"}
                          {t.orderId ? ` · order ${shortId(t.orderId)}` : ""}
                        </div>
                        {t.lastMessagePreview ? (
                          <div className="mt-0.5 max-w-[18rem] truncate text-ink-soft">
                            {t.lastMessagePreview}
                          </div>
                        ) : null}
                      </TD>
                      <TD>
                        <Badge tone={grievanceStatusTone(t.status)}>{humanise(t.status)}</Badge>
                      </TD>
                      {/*
                        Both clocks in one cell. `firstResponseMet` is a permanent
                        fact once earned, so a met first response is shown even on
                        a ticket whose resolution clock has since gone red.
                      */}
                      <TD className="text-xs">
                        {t.sla.breached ? (
                          <Badge tone="danger">
                            {t.sla.firstResponseBreached && !t.sla.firstResponseMet
                              ? "First reply overdue"
                              : "Resolution overdue"}
                          </Badge>
                        ) : remaining ? (
                          <span className={t.sla.minutesRemaining !== null && t.sla.minutesRemaining < 60 ? "font-semibold text-warning" : "text-ink-soft"}>
                            {remaining}
                          </span>
                        ) : (
                          <span className="text-ink-muted">
                            {t.sla.resolutionMet ? "Met" : "No clock"}
                          </span>
                        )}
                      </TD>
                      <TD className="text-xs">
                        {t.assigneeName ?? <span className="text-warning">Unassigned</span>}
                      </TD>
                      <TD className="whitespace-nowrap text-xs">{fmtRelative(t.updatedAt)}</TD>
                    </TR>
                  );
                })}
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
        <SectionHeading
          title="Approved response templates"
          description="Offered in the composer on every ticket. Retiring one keeps the wording that was already sent."
        />
        <GrievanceTemplateManager templates={templates} />
      </Card>

      <Card className="mt-4">
        <p className="text-xs text-ink-soft">
          A ticket&apos;s SLA is judged against the clock it was given when it was raised, not against today&apos;s
          policy. Relaxing an SLA in settings therefore cannot un-breach anything already in this list, and changing a
          ticket&apos;s priority does not move its deadline — the timeline records the judgement instead.
        </p>
      </Card>
    </div>
  );
}
