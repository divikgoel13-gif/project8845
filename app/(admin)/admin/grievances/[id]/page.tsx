import Link from "next/link";
import { notFound } from "next/navigation";

import { requireSuperAdmin } from "@/lib/auth/guards";
import {
  getGrievance,
  listGrievanceTemplates,
  listSupportAgents,
} from "@/lib/admin/grievances";
import { formatSlaRemaining } from "@/lib/grievance/sla";
import { paiseToRupeesDisplay } from "@/lib/money";
import { fmtDateTime, fmtRelative, humanise, shortId, TIMEZONE_NOTE } from "@/lib/admin/format";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge, grievanceStatusTone, grievancePriorityTone, orderStatusTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { RecordRefundForm } from "@/components/admin/record-refund-form";
import {
  GrievanceAssignment,
  GrievanceComposer,
  GrievanceEscalate,
  GrievanceLinkOrder,
  GrievancePriorityControl,
  GrievanceReopen,
  GrievanceStatusControl,
} from "@/components/admin/grievance-workspace-controls";

/**
 * One ticket, as UNI8 support works it (SRS §13).
 *
 * The layout follows the order an agent actually needs things in. First the
 * facts that decide what to do (status, both SLA clocks, who owns it, what it is
 * linked to). Then the conversation. Then the immutable timeline, which is the
 * §13 audit requirement and the Phase 8 completion standard's "complete
 * auditable timeline" — it merges messages, status changes, assignments,
 * escalations, reopenings and refunds into one ordered list so nobody has to
 * reconstruct a sequence of events from three tables.
 *
 * Internal notes are rendered inline with the customer-visible thread rather
 * than in a separate tab, deliberately: an agent reading the history needs to
 * see the note that explains why the next reply was worded the way it was. They
 * are visually unmistakable, and the requester's own view is fed by a different
 * query that RLS strips them from — this page is not the thing keeping them
 * private.
 */

export const dynamic = "force-dynamic";

export default async function AdminGrievanceDetailPage({ params }: { params: { id: string } }) {
  const admin = await requireSuperAdmin();

  const [ticket, agents, templates] = await Promise.all([
    getGrievance(params.id),
    listSupportAgents(),
    listGrievanceTemplates(),
  ]);
  if (!ticket) notFound();

  const terminal = ticket.status === "resolved" || ticket.status === "closed";
  const remaining = formatSlaRemaining(ticket.sla.minutesRemaining);
  const refundedPaise = ticket.refunds
    .filter((r) => r.status !== "failed")
    .reduce((sum, r) => sum + r.amountPaise, 0);

  return (
    <div>
      <PageHeader
        breadcrumb={[
          { label: "Grievances", href: "/admin/grievances" },
          { label: ticket.ticketNo ? `#${ticket.ticketNo}` : shortId(ticket.id) },
        ]}
        title={`${humanise(ticket.category)} — ${ticket.requesterName ?? "Unnamed account"}`}
        description={`Raised ${fmtDateTime(ticket.createdAt)} by a ${humanise(ticket.requesterRole).toLowerCase()}. ${TIMEZONE_NOTE}.`}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={grievanceStatusTone(ticket.status)}>{humanise(ticket.status)}</Badge>
            <Badge tone={grievancePriorityTone(ticket.priority)}>{humanise(ticket.priority)}</Badge>
            {ticket.escalatedAt ? <Badge tone="danger">Escalated</Badge> : null}
            {ticket.reopenedCount > 0 ? (
              <Badge tone="warning">Reopened {ticket.reopenedCount}×</Badge>
            ) : null}
          </div>
        }
      />

      {/* ── SLA, stated as two separate clocks ─────────────────────────── */}
      <Card className={ticket.sla.breached ? "border-danger/40 bg-danger-bg" : undefined}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">First response</p>
            <p className="mt-1 text-sm font-semibold">
              {ticket.firstResponseAt ? (
                ticket.sla.firstResponseMet ? (
                  <span className="text-success">Met — {fmtRelative(ticket.firstResponseAt)}</span>
                ) : (
                  <span className="text-danger">Late — {fmtDateTime(ticket.firstResponseAt)}</span>
                )
              ) : ticket.sla.firstResponseBreached ? (
                <span className="text-danger">Overdue, still unanswered</span>
              ) : (
                <span className="text-warning">Not answered yet</span>
              )}
            </p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Due {ticket.sla.firstResponseDueAt ? fmtDateTime(ticket.sla.firstResponseDueAt) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Resolution</p>
            <p className="mt-1 text-sm font-semibold">
              {ticket.resolvedAt ? (
                ticket.sla.resolutionMet ? (
                  <span className="text-success">Met — {fmtRelative(ticket.resolvedAt)}</span>
                ) : (
                  <span className="text-danger">Late — {fmtDateTime(ticket.resolvedAt)}</span>
                )
              ) : ticket.sla.resolutionBreached ? (
                <span className="text-danger">Overdue</span>
              ) : (
                <span className="text-ink">{remaining ?? "Open"}</span>
              )}
            </p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Due {ticket.sla.resolutionDueAt ? fmtDateTime(ticket.sla.resolutionDueAt) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Owner</p>
            <p className="mt-1 text-sm font-semibold">
              {ticket.assigneeName ?? <span className="text-warning">Unassigned</span>}
            </p>
            <p className="mt-0.5 text-xs text-ink-muted">
              {ticket.assigneeId === admin.id ? "That is you." : "Reassign in the sidebar."}
            </p>
          </div>
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* ── Left: resolution, conversation, timeline ─────────────────── */}
        <div className="flex flex-col gap-4">
          {terminal && ticket.resolutionNote ? (
            <Card className="border-success/40 bg-success-bg">
              <p className="text-xs font-semibold uppercase tracking-wide text-success">
                Resolved as {humanise(ticket.resolutionCategory ?? "unspecified")}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{ticket.resolutionNote}</p>
              <p className="mt-2 text-xs text-ink-muted">
                {ticket.resolvedAt ? `Resolved ${fmtDateTime(ticket.resolvedAt)}. ` : ""}
                {ticket.closedAt ? `Closed ${fmtDateTime(ticket.closedAt)}. ` : ""}
                The requester sees this note.
              </p>
            </Card>
          ) : null}

          {ticket.escalationReason ? (
            <Card className="border-danger/40 bg-danger-bg">
              <p className="text-xs font-semibold uppercase tracking-wide text-danger">Escalated</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{ticket.escalationReason}</p>
              <p className="mt-2 text-xs text-ink-muted">
                {ticket.escalatedByName ? `Raised by ${ticket.escalatedByName}. ` : ""}
                {ticket.escalatedAt ? fmtDateTime(ticket.escalatedAt) : ""}
              </p>
            </Card>
          ) : null}

          {ticket.reopenReason ? (
            <Card className="border-warning/40 bg-warning-bg">
              <p className="text-xs font-semibold uppercase tracking-wide text-warning">
                Reopened {ticket.reopenedCount}×
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{ticket.reopenReason}</p>
              <p className="mt-2 text-xs text-ink-muted">
                {ticket.reopenedAt ? `Last reopened ${fmtDateTime(ticket.reopenedAt)}. ` : ""}
                The earlier resolution is kept above and in the timeline.
              </p>
            </Card>
          ) : null}

          <Card>
            <SectionHeading
              title="Conversation"
              description="Internal notes are tinted and are never sent to the requester."
            />
            {ticket.messages.length === 0 ? (
              <EmptyState title="No messages" hint="The ticket was opened without a body." />
            ) : (
              <div className="flex flex-col gap-3">
                {ticket.messages.map((m) => (
                  <div
                    key={m.id}
                    className={
                      m.isInternal
                        ? "rounded-brand border border-warning/50 bg-warning-bg px-3 py-2"
                        : m.senderId === ticket.requesterId
                          ? "rounded-brand border border-cream-300 bg-cream-50 px-3 py-2"
                          : "rounded-brand border border-maroon-500/30 bg-orange-50 px-3 py-2"
                    }
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-ink">
                        {m.senderName ?? (m.senderId === ticket.requesterId ? "Requester" : "UNI8 support")}
                      </span>
                      {m.senderRole ? (
                        <span className="text-ink-muted">{humanise(m.senderRole)}</span>
                      ) : null}
                      {m.isInternal ? <Badge tone="warning">Internal note</Badge> : null}
                      <span className="text-ink-muted">{fmtDateTime(m.createdAt)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{m.body}</p>
                    {m.attachments.length > 0 ? (
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {m.attachments.map((a) => (
                          <li key={a.id}>
                            {a.url ? (
                              <a
                                href={a.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex rounded-brand border border-cream-300 bg-cream-50 px-2 py-1 text-xs font-medium text-maroon-600 hover:underline"
                              >
                                {a.name}
                              </a>
                            ) : (
                              <span className="inline-flex rounded-brand border border-cream-300 px-2 py-1 text-xs text-ink-muted">
                                {a.name} — link unavailable
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 border-t border-cream-200 pt-4">
              <GrievanceComposer ticketId={ticket.id} templates={templates} canAttach={!terminal} />
            </div>
          </Card>

          {/*
            The immutable record. Nothing here is editable and nothing is ever
            removed — a correction is a new entry, which is why a ticket that
            was resolved, reopened and resolved again reads as three events
            rather than one overwritten state.
          */}
          <Card>
            <SectionHeading
              title="Timeline"
              description="Every message, status change, reassignment, escalation and refund, oldest first. Append-only."
            />
            <ol className="flex flex-col gap-2.5">
              {ticket.timeline.map((entry) => (
                <li key={entry.key} className="flex gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-maroon-500" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{entry.title}</p>
                    {entry.detail ? (
                      <p className="mt-0.5 whitespace-pre-wrap text-xs text-ink-soft">{entry.detail}</p>
                    ) : null}
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {fmtDateTime(entry.at)}
                      {entry.actorName ? ` · ${entry.actorName}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        {/* ── Right: linked records and the controls ───────────────────── */}
        <div className="flex flex-col gap-4">
          <Card>
            <SectionHeading title="Requester" />
            <dl className="flex flex-col gap-1.5 text-sm">
              <Row label="Name" value={ticket.requesterName ?? "Unnamed account"} />
              <Row label="Role" value={humanise(ticket.requesterRole)} />
              <Row label="Phone" value={ticket.requesterPhone ?? "—"} />
              <Row label="Email" value={ticket.requesterEmail ?? "—"} />
            </dl>
            {ticket.requesterRole === "customer" ? (
              <Link
                href={`/admin/customers/${ticket.requesterId}`}
                className="mt-3 inline-block text-sm font-semibold text-maroon-600 underline"
              >
                Open Customer 360
              </Link>
            ) : null}
          </Card>

          <Card>
            <SectionHeading
              title="Linked records"
              description="What this ticket is actually about."
            />
            {ticket.order ? (
              <div className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">Order {shortId(ticket.order.id)}</span>
                  <Badge tone={orderStatusTone(ticket.order.status)}>{humanise(ticket.order.status)}</Badge>
                </div>
                <dl className="mt-1.5 flex flex-col gap-1 text-xs">
                  <Row label="Restaurant" value={ticket.order.restaurantName ?? "—"} />
                  <Row label="Order total" value={paiseToRupeesDisplay(ticket.order.totalPaise)} />
                  <Row label="Pickup slot" value={ticket.order.pickupTime ? fmtDateTime(ticket.order.pickupTime) : "—"} />
                  <Row label="Marked ready" value={ticket.order.readyAt ? fmtDateTime(ticket.order.readyAt) : "—"} />
                  <Row label="Collected" value={ticket.order.collectedAt ? fmtDateTime(ticket.order.collectedAt) : "Not collected"} />
                </dl>
                {ticket.order.restaurantName && ticket.restaurantId ? (
                  <Link
                    href={`/admin/restaurants/${ticket.restaurantId}/dashboard`}
                    className="mt-2 inline-block text-xs font-semibold text-maroon-600 underline"
                  >
                    Open the restaurant workspace
                  </Link>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-ink-muted">
                No order linked. Attach one below and the restaurant is filled in from the order, so a mismatched pair
                cannot be stored.
              </p>
            )}

            {ticket.payment ? (
              <div className="mt-3 rounded-brand border border-cream-300 bg-cream-50 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">Payment</span>
                  <Badge tone={ticket.payment.status === "captured" ? "success" : "warning"}>
                    {humanise(ticket.payment.status)}
                  </Badge>
                </div>
                <dl className="mt-1.5 flex flex-col gap-1 text-xs">
                  <Row label="Amount" value={paiseToRupeesDisplay(ticket.payment.amountPaise)} />
                  <Row label="Gateway id" value={ticket.payment.razorpayPaymentId ?? "—"} />
                  <Row label="Taken" value={fmtDateTime(ticket.payment.createdAt)} />
                </dl>
              </div>
            ) : null}

            {ticket.disbursementId ? (
              <p className="mt-3 text-xs text-ink-soft">
                Raised against payout{" "}
                <Link href="/admin/payments" className="font-semibold text-maroon-600 underline">
                  {shortId(ticket.disbursementId)}
                </Link>
                .
              </p>
            ) : null}

            <div className="mt-3 border-t border-cream-200 pt-3">
              <GrievanceLinkOrder ticketId={ticket.id} orderId={ticket.orderId} />
            </div>
          </Card>

          <Card>
            <SectionHeading
              title="Evidence"
              description="Every file on this ticket. Links expire in five minutes."
            />
            {ticket.attachments.length === 0 ? (
              <p className="text-xs text-ink-muted">
                No files attached. Ask the requester for a photo through the reply box — the picker
                appears under it on their side too.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-xs">
                {ticket.attachments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2">
                    {a.url ? (
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate font-medium text-maroon-600 hover:underline"
                      >
                        {a.name}
                      </a>
                    ) : (
                      <span className="truncate text-ink-muted">{a.name}</span>
                    )}
                    <span className="shrink-0 text-ink-muted">
                      {a.createdAt ? fmtRelative(a.createdAt) : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <SectionHeading
              title="Refunds"
              description="Recorded against the ticket, additive only."
            />
            {ticket.refunds.length === 0 ? (
              <p className="text-xs text-ink-muted">Nothing refunded on this ticket.</p>
            ) : (
              <>
                <ul className="flex flex-col gap-1.5 text-xs">
                  {ticket.refunds.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <span className="text-ink">
                        {paiseToRupeesDisplay(r.amountPaise)} · {humanise(r.status)}
                      </span>
                      <span className="text-ink-muted">{fmtRelative(r.createdAt)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs font-semibold text-ink">
                  Total refunded {paiseToRupeesDisplay(refundedPaise)}
                </p>
              </>
            )}
            {ticket.orderId ? (
              <div className="mt-3 border-t border-cream-200 pt-3">
                <RecordRefundForm ticketId={ticket.id} />
              </div>
            ) : (
              <p className="mt-2 text-xs text-ink-muted">
                Link an order before recording a refund — a refund with no order has nothing to reconcile against.
              </p>
            )}
          </Card>

          <Card>
            <SectionHeading title="Handling" />
            <div className="flex flex-col gap-4">
              <GrievanceAssignment
                ticketId={ticket.id}
                assigneeId={ticket.assigneeId}
                agents={agents}
                viewerId={admin.id}
              />
              <GrievancePriorityControl ticketId={ticket.id} priority={ticket.priority} />
              {terminal ? (
                <GrievanceReopen ticketId={ticket.id} />
              ) : (
                <GrievanceStatusControl
                  ticketId={ticket.id}
                  status={ticket.status}
                  resolutionCategory={ticket.resolutionCategory}
                />
              )}
              <GrievanceEscalate
                ticketId={ticket.id}
                agents={agents}
                escalated={Boolean(ticket.escalatedAt)}
              />
            </div>
          </Card>

          {ticket.csatScore !== null ? (
            <Card>
              <SectionHeading title="Requester rating" />
              <p className="font-display text-2xl font-bold text-ink">{ticket.csatScore} / 5</p>
              {ticket.csatComment ? (
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{ticket.csatComment}</p>
              ) : null}
              <p className="mt-1 text-xs text-ink-muted">
                {ticket.csatSubmittedAt ? fmtDateTime(ticket.csatSubmittedAt) : ""}
              </p>
            </Card>
          ) : terminal ? (
            <Card>
              <p className="text-xs text-ink-muted">
                The requester has not rated this yet. Ratings are optional and cannot be requested twice.
              </p>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-words text-right text-ink">{value}</dd>
    </div>
  );
}
