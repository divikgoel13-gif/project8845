import Link from "next/link";
import { notFound } from "next/navigation";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { getCustomer360, type TimelineEvent } from "@/lib/admin/customers";
import { paiseToRupeesDisplay } from "@/lib/money";
import { fmtDate, fmtDateTime, fmtRelative, fmtCount, humanise, shortId, TIMEZONE_NOTE } from "@/lib/admin/format";
import { orderStatusLabel } from "@/lib/orders/status-groups";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import {
  Badge,
  orderStatusTone,
  grievanceStatusTone,
  grievancePriorityTone,
  type BadgeTone,
} from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap, Table, THead, TBody, TR, TH, THNum, TD, TDNum } from "@/components/ui/table";
import {
  AdminNoteComposer,
  AddCustomerFlagForm,
  ClearFlagButton,
  CustomerAccountStatusControl,
} from "@/components/admin/customer-crm-controls";

/**
 * Customer 360 (SRS §7.2).
 *
 * §7.2 names ten sections and this page has all of them, but two — Orders and
 * Grievances — are deliberately INDEXES that link out to `/admin/orders/[id]` and
 * `/admin/grievances/[id]` rather than reproductions. Those pages already own an
 * order's money and a ticket's message thread, and a second rendering of either
 * inside the CRM would eventually disagree with the first.
 *
 * Two sections are honest about what this schema can evidence. "Account &
 * Security" is built from `audit_logs` entries targeting this profile, because
 * `profiles` has no `last_login_at` and Supabase keeps sign-in history in the
 * `auth` schema, which this console does not read. And QR issuance appears on the
 * order row rather than as a dated timeline event, because `orders.scan_token`
 * records that a token exists, not when it was minted.
 *
 * Everything here is internal. The SRS is explicit that customers do not access
 * the CRM, and RLS in 0017 enforces it: notes and flags have super-admin-only
 * policies with no self-select clause.
 */

export const dynamic = "force-dynamic";

/**
 * Offered in the flag composer as a `datalist`, not an enum. These are the manual
 * cases that have actually come up, and the operator can still type something
 * else — the whole point of a manual flag is the situation the derived ones cannot
 * see. They live here rather than in the actions module because a `"use server"`
 * file may only export async functions.
 */
const FLAG_SUGGESTIONS = [
  "Disputed charge",
  "Abusive conduct",
  "Refund agreed off-platform",
  "Suspected account sharing",
  "University escalation",
  "Do not contact",
];

const TIMELINE_TONES: Record<TimelineEvent["kind"], BadgeTone> = {
  account: "neutral",
  order: "info",
  payment: "success",
  refund: "warning",
  rating: "accent",
  grievance: "warning",
  flag: "danger",
  note: "neutral",
  notification: "neutral",
};

export default async function Customer360Page({ params }: { params: { customerId: string } }) {
  await requireSuperAdmin();
  const customer = await getCustomer360(params.customerId);

  // Null covers both "no such profile" and "this id is not a customer" — §7 scopes
  // the CRM to customers, and rendering a staff profile here would turn a support
  // tool into a general people browser.
  if (!customer) notFound();

  const { profile, overview } = customer;

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: "Customers", href: "/admin/customers" }, { label: profile.name ?? "Customer" }]}
        title={profile.name ?? "Unnamed account"}
        description={`Joined ${fmtDate(profile.joinedAt)}. Internal record — nothing on this page is visible to the customer. ${TIMEZONE_NOTE}.`}
        actions={
          <div className="flex flex-wrap items-start gap-2">
            <ButtonLink href={`/admin/orders?customerId=${profile.id}`} variant="secondary">
              Orders in context
            </ButtonLink>
            <CustomerAccountStatusControl customerId={profile.id} status={profile.accountStatus} />
          </div>
        }
      />

      {profile.accountStatus === "disabled" ? (
        <Card className="mb-4 border-danger/40 bg-danger-bg">
          <p className="text-xs text-danger">
            This account is disabled and cannot sign in. Nothing else was undone by disabling it — any refund owed is
            still owed, and any open ticket still needs an answer. See Account &amp; security below for who disabled it
            and why.
          </p>
        </Card>
      ) : null}

      <Card className="mb-4">
        <SectionHeading title="Identity" description="From the customer's own profile. Editing it is theirs to do, not ours." />
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Email</dt>
            <dd className="mt-0.5 break-all text-ink">{profile.email ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Phone</dt>
            <dd className="mt-0.5 text-ink">{profile.phone ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Course</dt>
            <dd className="mt-0.5 text-ink">{profile.course ?? "Not given"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Customer ID</dt>
            <dd className="mt-0.5 font-mono text-xs text-ink-soft">{profile.id}</dd>
          </div>
        </dl>
      </Card>

      <StatGrid className="lg:grid-cols-4">
        <Stat
          label="Lifetime spend"
          value={paiseToRupeesDisplay(overview.lifetimeSpendPaise)}
          hint="Completed orders, from each order's own snapshot"
        />
        <Stat
          label="Orders completed"
          value={`${overview.realizedCount} of ${overview.orderCount}`}
          hint="Carts excluded — a basket is not an order"
        />
        <Stat
          label="Average order"
          value={overview.averageOrderPaise === null ? "—" : paiseToRupeesDisplay(overview.averageOrderPaise)}
          hint="Across completed orders only"
        />
        <Stat
          label="Rating given"
          value={overview.averageStars === null ? "—" : `${overview.averageStars.toFixed(1)} / 5`}
          hint={`${fmtCount(overview.ratingCount)} rating${overview.ratingCount === 1 ? "" : "s"} left`}
        />
        <Stat
          label="Cancelled"
          value={fmtCount(overview.cancelledCount)}
          tone={overview.cancelledCount > 0 ? "warning" : "default"}
          hint="By the customer or by the vendor"
        />
        <Stat
          label="No-shows"
          value={fmtCount(overview.noShowCount)}
          tone={overview.noShowCount > 0 ? "danger" : "default"}
          hint="Paid for and never collected"
        />
        <Stat
          label="Refunded orders"
          value={fmtCount(overview.refundedCount)}
          hint="Money returned, in part or in full"
        />
        <Stat
          label="Support issues"
          value={`${overview.openIssueCount} open`}
          tone={overview.openIssueCount > 0 ? "warning" : "default"}
          hint={`${fmtCount(overview.totalIssueCount)} raised in total`}
        />
      </StatGrid>

      <Card className="mt-4">
        <SectionHeading
          title="Signals"
          description="Computed from this customer's own history on every read, so they cannot go stale. The number behind each one is shown, because “high value” is an assertion and “₹6,240 across 14 orders” is a fact."
          actions={<AddCustomerFlagForm customerId={profile.id} suggestions={FLAG_SUGGESTIONS} />}
        />

        {customer.derivedFlags.length === 0 ? (
          <p className="text-xs text-ink-muted">
            Nothing stands out. No spend, cancellation, no-show, payment or support pattern crosses a threshold.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {customer.derivedFlags.map((f) => (
              <li key={f.key} className="flex items-start gap-2 rounded-brand bg-cream-100 px-3 py-2">
                <Badge tone={f.tone}>{f.label}</Badge>
                <span className="text-xs text-ink-soft">{f.detail}</span>
              </li>
            ))}
          </ul>
        )}

        {customer.manualFlags.length > 0 ? (
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Raised by an admin</h3>
            <ul className="mt-2 space-y-2">
              {customer.manualFlags.map((f) => (
                <li
                  key={f.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-brand border border-cream-300 px-3 py-2"
                >
                  <div>
                    <Badge tone="accent">{f.flag}</Badge>
                    <p className="mt-1 text-xs text-ink-soft">{f.reason}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {f.createdByName ?? "An admin"} · {fmtDateTime(f.createdAt)}
                    </p>
                  </div>
                  <ClearFlagButton flagId={f.id} flag={f.flag} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {customer.clearedFlags.length > 0 ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-semibold text-ink-soft">
              {`${customer.clearedFlags.length} cleared flag${customer.clearedFlags.length === 1 ? "" : "s"}`}
            </summary>
            <ul className="mt-2 space-y-2">
              {customer.clearedFlags.map((f) => (
                <li key={f.id} className="rounded-brand bg-cream-100 px-3 py-2 text-xs text-ink-soft">
                  <span className="font-semibold text-ink">{f.flag}</span> — raised {fmtDate(f.createdAt)} by{" "}
                  {f.createdByName ?? "an admin"} ({f.reason}); cleared {fmtDate(f.clearedAt)} by{" "}
                  {f.clearedByName ?? "an admin"}
                  {f.clearReason ? ` (${f.clearReason})` : ""}.
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>

      <Card className="mt-4">
        <SectionHeading
          title="Orders"
          description="An index, not a copy. Every row links to the order's own page, which owns its money, its items and its audit trail."
        />
        {customer.orders.length === 0 ? (
          <p className="text-xs text-ink-muted">This customer has never placed an order.</p>
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Order</TH>
                  <TH>Placed</TH>
                  <TH>Restaurant</TH>
                  <TH>Status</TH>
                  <TH>Items</TH>
                  <THNum>Subtotal</THNum>
                </TR>
              </THead>
              <TBody>
                {customer.orders.map((o) => (
                  <TR key={o.id} className="hover:bg-cream-100">
                    <TD>
                      <Link href={`/admin/orders/${o.id}`} className="font-mono text-xs font-semibold text-ink hover:underline">
                        {shortId(o.id)}
                      </Link>
                      {o.groupId ? (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide text-ink-muted">multi</span>
                      ) : null}
                      {o.qrIssued ? (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide text-ink-muted">QR</span>
                      ) : null}
                    </TD>
                    <TD className="whitespace-nowrap text-xs">{fmtDateTime(o.createdAt)}</TD>
                    <TD className="text-xs">
                      <Link href={`/admin/restaurants/${o.restaurantId}/dashboard`} className="hover:underline">
                        {o.restaurantName}
                      </Link>
                    </TD>
                    <TD>
                      <Badge tone={orderStatusTone(o.status)}>{orderStatusLabel(o.status)}</Badge>
                    </TD>
                    <TD className="max-w-xs text-xs text-ink-soft">{o.itemSummary}</TD>
                    <TDNum>{paiseToRupeesDisplay(o.subtotalPaise)}</TDNum>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <SectionHeading
            title="Payments"
            description="One payment can pay for several orders in one checkout, which is why the order column can list more than one id."
          />
          {customer.payments.length === 0 ? (
            <p className="text-xs text-ink-muted">No payment attempt has ever been recorded for this customer.</p>
          ) : (
            <ul className="space-y-2">
              {customer.payments.map((p) => (
                <li key={p.id} className="rounded-brand border border-cream-300 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge tone={p.status === "captured" ? "success" : p.status === "failed" ? "danger" : "info"}>
                      {humanise(p.status)}
                    </Badge>
                    <span className="font-display text-sm font-semibold tabular-nums text-ink">
                      {paiseToRupeesDisplay(p.amountPaise)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">{fmtDateTime(p.createdAt)}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-muted">
                    {p.orderIds.length === 0 ? (
                      <span>No order matched this payment — see reconciliation.</span>
                    ) : (
                      p.orderIds.map((id) => (
                        <Link key={id} href={`/admin/orders/${id}`} className="font-mono hover:underline">
                          {shortId(id)}
                        </Link>
                      ))
                    )}
                  </p>
                  {p.razorpayPaymentId ? (
                    <p className="mt-0.5 font-mono text-[10px] text-ink-muted">{p.razorpayPaymentId}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionHeading
            title="Refunds"
            description="Every refund is an additive event against an order, never an edit of the original amount (§11.5). A refund raised from a ticket links back to it."
          />
          {customer.refunds.length === 0 ? (
            <p className="text-xs text-ink-muted">Nothing has been refunded to this customer.</p>
          ) : (
            <ul className="space-y-2">
              {customer.refunds.map((r) => (
                <li key={r.id} className="rounded-brand border border-cream-300 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge tone={r.status === "processed" ? "success" : r.status === "failed" ? "danger" : "warning"}>
                      {humanise(r.status)}
                    </Badge>
                    <span className="font-display text-sm font-semibold tabular-nums text-ink">
                      {paiseToRupeesDisplay(r.amountPaise)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">{fmtDateTime(r.createdAt)}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-muted">
                    <Link href={`/admin/orders/${r.orderId}`} className="font-mono hover:underline">
                      {shortId(r.orderId)}
                    </Link>
                    {r.grievanceTicketId ? (
                      <Link href={`/admin/grievances/${r.grievanceTicketId}`} className="hover:underline">
                        from a support ticket
                      </Link>
                    ) : null}
                  </p>
                  {r.razorpayRefundId ? (
                    <p className="mt-0.5 font-mono text-[10px] text-ink-muted">{r.razorpayRefundId}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <SectionHeading
          title="Support history"
          description="An index into the grievance CRM, which owns the message thread, attachments, assignment and reopen trail."
        />
        {customer.grievances.length === 0 ? (
          <p className="text-xs text-ink-muted">This customer has never raised a ticket.</p>
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Ticket</TH>
                  <TH>Raised</TH>
                  <TH>About</TH>
                  <TH>Status</TH>
                  <TH>Priority</TH>
                  <TH>Assigned to</TH>
                  <THNum>Messages</THNum>
                </TR>
              </THead>
              <TBody>
                {customer.grievances.map((t) => (
                  <TR key={t.id} className="hover:bg-cream-100">
                    <TD>
                      <Link href={`/admin/grievances/${t.id}`} className="text-xs font-semibold text-ink hover:underline">
                        {t.ticketNo === null ? shortId(t.id) : `#${t.ticketNo}`}
                      </Link>
                      {t.reopenedCount > 0 ? (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide text-warning">
                          reopened {t.reopenedCount}×
                        </span>
                      ) : null}
                    </TD>
                    <TD className="whitespace-nowrap text-xs">{fmtDate(t.createdAt)}</TD>
                    <TD className="text-xs text-ink-soft">
                      {humanise(t.category)}
                      {t.restaurantName ? ` · ${t.restaurantName}` : ""}
                      {t.orderId ? (
                        <Link href={`/admin/orders/${t.orderId}`} className="ml-1 font-mono hover:underline">
                          {shortId(t.orderId)}
                        </Link>
                      ) : null}
                    </TD>
                    <TD>
                      <Badge tone={grievanceStatusTone(t.status)}>{humanise(t.status)}</Badge>
                    </TD>
                    <TD>
                      <Badge tone={grievancePriorityTone(t.priority)}>{humanise(t.priority)}</Badge>
                    </TD>
                    <TD className="text-xs">{t.assigneeName ?? <span className="text-ink-muted">Unassigned</span>}</TD>
                    <TDNum>{t.messageCount}</TDNum>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <SectionHeading
            title="Restaurant affinity"
            description="Where this customer actually spends. Completed orders only — a cancelled order is not affinity."
          />
          {customer.affinity.length === 0 ? (
            <p className="text-xs text-ink-muted">No completed orders yet, so there is nothing to prefer.</p>
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Restaurant</TH>
                    <THNum>Orders</THNum>
                    <THNum>Spend</THNum>
                    <TH>Last</TH>
                  </TR>
                </THead>
                <TBody>
                  {customer.affinity.map((a) => (
                    <TR key={a.restaurantId}>
                      <TD className="text-xs">
                        <Link href={`/admin/restaurants/${a.restaurantId}/dashboard`} className="hover:underline">
                          {a.restaurantName}
                        </Link>
                      </TD>
                      <TDNum>{a.orderCount}</TDNum>
                      <TDNum>{paiseToRupeesDisplay(a.spendPaise)}</TDNum>
                      <TD className="whitespace-nowrap text-xs text-ink-soft">
                        {a.lastOrderAt ? fmtRelative(a.lastOrderAt) : "—"}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>

        <Card>
          <SectionHeading
            title="Ratings left"
            description="What this customer said about their orders, newest first."
          />
          {customer.ratings.length === 0 ? (
            <p className="text-xs text-ink-muted">This customer has never rated an order.</p>
          ) : (
            <ul className="space-y-2">
              {customer.ratings.map((r) => (
                <li key={r.id} className="rounded-brand border border-cream-300 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-ink">{r.stars} / 5</span>
                    <span className="text-xs text-ink-muted">{r.restaurantName}</span>
                  </div>
                  {r.comment?.trim() ? <p className="mt-1 text-xs text-ink-soft">{r.comment}</p> : null}
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {fmtDate(r.createdAt)} ·{" "}
                    <Link href={`/admin/orders/${r.orderId}`} className="font-mono hover:underline">
                      {shortId(r.orderId)}
                    </Link>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <SectionHeading
            title="Admin notes"
            description="Internal only. The customer cannot read these — the table has no self-select policy — and neither can a vendor."
          />
          <AdminNoteComposer customerId={profile.id} />
          {customer.notes.length === 0 ? (
            <p className="mt-3 text-xs text-ink-muted">No notes yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {customer.notes.map((n) => (
                <li key={n.id} className="rounded-brand bg-cream-100 px-3 py-2">
                  <p className="whitespace-pre-wrap text-xs text-ink">{n.body}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {n.authorName ?? "An admin"}
                    {n.authorRole ? ` (${humanise(n.authorRole)})` : ""} · {fmtDateTime(n.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionHeading
            title="Account & security"
            description="What this platform can actually evidence: administrative changes to the account, with actor and reason. Sign-in history lives in the authentication service and is not read by this console."
          />
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Account state</dt>
              <dd className="mt-0.5">
                <Badge tone={profile.accountStatus === "active" ? "success" : "danger"}>
                  {profile.accountStatus === "active" ? "Active" : "Disabled"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Profile last changed</dt>
              <dd className="mt-0.5 text-xs text-ink-soft">{fmtDateTime(profile.updatedAt)}</dd>
            </div>
          </dl>
          {customer.securityEvents.length === 0 ? (
            <p className="mt-3 text-xs text-ink-muted">
              No administrative action has ever been taken on this account.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {customer.securityEvents.map((e) => (
                <li key={e.id} className="rounded-brand border border-cream-300 px-3 py-2 text-xs">
                  <p className="font-semibold text-ink">{humanise(e.action)}</p>
                  <p className="mt-0.5 text-ink-soft">
                    {e.actorName ?? "System"}
                    {e.actorRole ? ` (${humanise(e.actorRole)})` : ""} · {fmtDateTime(e.createdAt)}
                  </p>
                  {e.reason ? <p className="mt-0.5 text-ink-muted">{e.reason}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <SectionHeading
          title="Timeline"
          description="Everything this customer did and everything that was done to them, in one order. Assembled from the records above rather than from a separate event table, so it cannot drift from them."
        />
        {customer.timeline.length === 0 ? (
          <EmptyState
            title="Nothing has happened yet"
            hint="The account exists and that is all. The first entry will appear when they place an order."
          />
        ) : (
          <ol className="space-y-2">
            {customer.timeline.map((e) => (
              <li key={e.key} className="flex flex-wrap items-start gap-2 border-b border-cream-200 pb-2 last:border-0">
                <span className="w-36 shrink-0 whitespace-nowrap text-xs text-ink-muted">{fmtDateTime(e.at)}</span>
                <Badge tone={TIMELINE_TONES[e.kind]}>{humanise(e.kind)}</Badge>
                <div className="min-w-[12rem] flex-1">
                  {e.href ? (
                    <Link href={e.href} className="text-sm font-semibold text-ink hover:underline">
                      {e.label}
                    </Link>
                  ) : (
                    <span className="text-sm font-semibold text-ink">{e.label}</span>
                  )}
                  {e.detail ? <p className="text-xs text-ink-soft">{e.detail}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-xs text-ink-muted">
          Two absences are deliberate. Sign-in and session events are not here, because they live in the
          authentication service rather than in this database — what is here is every administrative action taken on the
          account. And a pickup QR is reported on its order rather than as a dated entry of its own, because the
          database records that a token exists, not the moment it was issued.
        </p>
      </Card>
    </div>
  );
}
