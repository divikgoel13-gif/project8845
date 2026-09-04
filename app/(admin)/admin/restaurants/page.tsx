import Link from "next/link";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { listRestaurantsForAdmin, type RestaurantListFilters } from "@/lib/admin/restaurants";
import { paiseToRupeesDisplay } from "@/lib/money";
import { fmtDate, fmtRelative, fmtCount, TIMEZONE_NOTE } from "@/lib/admin/format";
import {
  restaurantStateLabel,
  type RestaurantLocationType,
  type RestaurantStatus,
} from "@/lib/restaurants/status";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge, restaurantStatusTone } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap, Table, THead, TBody, TR, TH, THNum, TD, TDNum } from "@/components/ui/table";
import { Pagination, parsePage } from "@/components/ui/pagination";

/**
 * Restaurant directory (SRS §6 "Restaurant creation and lifecycle", §29.1,
 * V2.6 §60).
 *
 * This is the entry point to every restaurant workspace, so each row carries the
 * three numbers an operator uses to decide whether to open it: how many products
 * are live, how much it has sold today, and how much money it is owed. A
 * directory that showed only names would mean opening fourteen workspaces to
 * find the one with a problem.
 *
 * The four §60 states are exposed as filter chips with counts rather than a
 * dropdown, because "which of my restaurants are closed right now" is the
 * question this screen exists to answer at a glance.
 *
 * Archived restaurants are excluded unless explicitly asked for: §P forbids
 * deleting them, which means the archive only grows, and a default view that
 * leads with dead rows gets worse every term.
 */

export const dynamic = "force-dynamic";

type Query = {
  status?: string;
  locationType?: string;
  q?: string;
  page?: string;
};

const STATUSES = ["active", "paused", "closed", "archived"] as const;

function parseStatus(raw: string | undefined): RestaurantListFilters["status"] {
  if (!raw) return undefined;
  if (raw === "all") return "all";
  return (STATUSES as readonly string[]).includes(raw) ? (raw as RestaurantStatus) : undefined;
}

function parseLocationType(raw: string | undefined): RestaurantLocationType | undefined {
  return raw === "inside_university" || raw === "outside_university" ? raw : undefined;
}

export default async function AdminRestaurantsPage({ searchParams }: { searchParams: Query }) {
  await requireSuperAdmin();

  const page = parsePage(searchParams.page);
  const filters: RestaurantListFilters = {
    status: parseStatus(searchParams.status),
    locationType: parseLocationType(searchParams.locationType),
    search: searchParams.q?.trim() || undefined,
    page,
  };

  const { rows, total, counts, pageSize } = await listRestaurantsForAdmin(filters);

  const carried: Record<string, string | undefined> = {
    status: searchParams.status,
    locationType: searchParams.locationType,
    q: searchParams.q,
  };

  // Chips are links, not buttons: a filtered directory has to be shareable, and
  // this keeps the whole screen working with JavaScript disabled.
  const chipHref = (status: string | null) => {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (searchParams.locationType) qs.set("locationType", searchParams.locationType);
    if (searchParams.q) qs.set("q", searchParams.q);
    const s = qs.toString();
    return `/admin/restaurants${s ? `?${s}` : ""}`;
  };

  const activeChip = searchParams.status ?? "";

  return (
    <div>
      <PageHeader
        title="Restaurants"
        description={`Every restaurant on the platform and its current trading state. Counters are for the campus day. ${TIMEZONE_NOTE}.`}
        actions={<ButtonLink href="/admin/restaurants/new">New restaurant</ButtonLink>}
      />

      <div className="flex flex-wrap gap-2">
        <Chip href={chipHref(null)} active={activeChip === ""} label="Trading + paused" count={counts.active + counts.paused + counts.closed} />
        <Chip href={chipHref("active")} active={activeChip === "active"} label="Active" count={counts.active} />
        <Chip href={chipHref("paused")} active={activeChip === "paused"} label="Paused" count={counts.paused} />
        <Chip href={chipHref("closed")} active={activeChip === "closed"} label="Closed" count={counts.closed} />
        <Chip href={chipHref("archived")} active={activeChip === "archived"} label="Archived" count={counts.archived} />
        <Chip href={chipHref("all")} active={activeChip === "all"} label="All" count={counts.active + counts.paused + counts.closed + counts.archived} />
      </div>

      <Card className="mt-4">
        <form method="get" action="/admin/restaurants" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search" htmlFor="q" hint="Name, slug or location">
            <Input id="q" name="q" defaultValue={searchParams.q ?? ""} placeholder="Cafe 24" />
          </Field>

          <Field label="Classification" htmlFor="locationType" hint="SRS §29.1">
            <Select id="locationType" name="locationType" defaultValue={searchParams.locationType ?? ""}>
              <option value="">Any</option>
              <option value="inside_university">Inside university</option>
              <option value="outside_university">Outside university</option>
            </Select>
          </Field>

          <Field label="State" htmlFor="status">
            <Select id="status" name="status" defaultValue={searchParams.status ?? ""}>
              <option value="">Trading + paused + closed</option>
              <option value="all">All, including archived</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {restaurantStateLabel(s)}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex items-end gap-2">
            <Button type="submit">Apply</Button>
            <ButtonLink href="/admin/restaurants" variant="ghost">
              Reset
            </ButtonLink>
          </div>
        </form>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          className="mt-4"
          title="No restaurants match these filters"
          hint="Archived restaurants are hidden unless you ask for them — they are never deleted, so the archive only grows."
        />
      ) : (
        <>
          <TableWrap className="mt-4">
            <Table>
              <THead>
                <TR>
                  <TH>Restaurant</TH>
                  <TH>State</TH>
                  <TH>Classification</TH>
                  <THNum>Products</THNum>
                  <THNum>Orders today</THNum>
                  <THNum>In flight</THNum>
                  <THNum>Outstanding payable</THNum>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id} className="hover:bg-cream-100">
                    <TD>
                      <Link
                        href={`/admin/restaurants/${r.id}/dashboard`}
                        className="font-semibold text-ink hover:underline"
                      >
                        {r.name}
                      </Link>
                      <span className="block font-mono text-[11px] text-ink-muted">/{r.slug}</span>
                      {r.location ? (
                        <span className="block text-[11px] text-ink-muted">{r.location}</span>
                      ) : null}
                    </TD>
                    <TD>
                      <Badge tone={restaurantStatusTone(r.operationalState)}>
                        {restaurantStateLabel(r.operationalState)}
                      </Badge>
                      {/*
                        The reason is shown inline, not behind a tooltip: an
                        operator scanning for the paused restaurant needs to know
                        whether it is a ten-minute breather or a supply problem.
                      */}
                      {r.operationalState === "paused-until" && r.pausedUntil ? (
                        <span className="block text-[11px] text-ink-muted">
                          Until {fmtRelative(r.pausedUntil)}
                        </span>
                      ) : null}
                      {r.operationalState === "paused" && r.pausedReason ? (
                        <span className="block text-[11px] text-ink-muted">{r.pausedReason}</span>
                      ) : null}
                      {(r.operationalState === "closed" || r.operationalState === "archived") &&
                      r.closedReason ? (
                        <span className="block text-[11px] text-ink-muted">{r.closedReason}</span>
                      ) : null}
                      {r.archivedAt ? (
                        <span className="block text-[11px] text-ink-muted">
                          Archived {fmtDate(r.archivedAt)}
                        </span>
                      ) : null}
                    </TD>
                    <TD>
                      {r.locationType === "inside_university" ? (
                        <>
                          <Badge tone="info">Inside university</Badge>
                          <span className="block text-[11px] text-ink-muted">
                            {r.universityPlaceName ?? "Place name missing"}
                          </span>
                        </>
                      ) : (
                        <Badge tone="neutral">Outside university</Badge>
                      )}
                    </TD>
                    <TDNum>{fmtCount(r.activeProducts)}</TDNum>
                    <TDNum>{fmtCount(r.ordersToday)}</TDNum>
                    <TDNum>
                      {r.inFlight > 0 ? (
                        <span className="font-semibold text-warning">{fmtCount(r.inFlight)}</span>
                      ) : (
                        "0"
                      )}
                    </TDNum>
                    <TDNum>{paiseToRupeesDisplay(r.outstandingPayablePaise)}</TDNum>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>

          <Pagination
            className="mt-4"
            page={page}
            pageSize={pageSize}
            total={total}
            basePath="/admin/restaurants"
            params={carried}
          />
        </>
      )}
    </div>
  );
}

function Chip({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={[
        "inline-flex items-center gap-1.5 rounded-brand border px-3 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "border-maroon-500 bg-maroon-500 text-cream-50"
          : "border-cream-300 bg-cream-50 text-ink-soft hover:bg-cream-200 hover:text-ink",
      ].join(" ")}
    >
      {label}
      <span className={active ? "text-cream-50/80" : "text-ink-muted"}>{fmtCount(count)}</span>
    </Link>
  );
}
