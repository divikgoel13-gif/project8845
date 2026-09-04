import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth/guards";
import { getCustomerTicket } from "@/lib/data/customer-grievances";
import { Card } from "@/components/ui/card";
import { Badge, grievanceStatusTone } from "@/components/ui/badge";
import {
  CustomerTicketReply,
  CustomerTicketReopen,
  CustomerTicketCsat,
} from "@/components/customer/support-thread";
import { humanise } from "@/lib/admin/format";

export const dynamic = "force-dynamic";

/**
 * One support ticket, as the requester sees it (SRS V2 §I).
 *
 * What is shown: the conversation, the outcome, and the three things they can
 * do. What is not shown, on purpose, because §I says customers do not access the
 * internal CRM: assignee, SLA clocks, priority, escalation, the audit trail, and
 * internal notes — the last of which are removed by RLS rather than filtered
 * here, so this page cannot leak them even if it tried.
 */
export default async function CustomerTicketPage({ params }: { params: { ticketId: string } }) {
  const profile = await requireProfile();
  const ticket = await getCustomerTicket(params.ticketId, profile.id);
  if (!ticket) notFound();

  const isTerminal = ticket.status === "resolved" || ticket.status === "closed";

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/support" className="text-sm text-ink-soft underline">
        Back to support
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {ticket.ticketNo ? `Ticket #${ticket.ticketNo}` : "Your ticket"}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {humanise(ticket.category)}
            {ticket.restaurantName ? ` · ${ticket.restaurantName}` : ""}
            {" · raised "}
            {new Date(ticket.createdAt).toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        </div>
        <Badge tone={grievanceStatusTone(ticket.status)}>{humanise(ticket.status)}</Badge>
      </div>

      {ticket.orderId && (
        <p className="mt-2 text-sm">
          <Link href="/orders" className="font-semibold text-maroon-600 underline">
            See the order this is about
          </Link>
        </p>
      )}

      {/*
        The resolution, shown above the thread rather than buried at the bottom
        of it: it is the answer to the question the customer opened the ticket
        with, and they should not have to scroll a conversation to find it.
      */}
      {isTerminal && ticket.resolutionNote && (
        <Card className="mt-6 border-success/40 bg-success-bg">
          <p className="text-sm font-semibold text-success">How we resolved it</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{ticket.resolutionNote}</p>
        </Card>
      )}

      {ticket.reopenedCount > 0 && (
        <p className="mt-3 text-xs text-ink-muted">
          Reopened {ticket.reopenedCount} {ticket.reopenedCount === 1 ? "time" : "times"}. The whole
          history is kept below.
        </p>
      )}

      <section className="mt-6 flex flex-col gap-3">
        {ticket.messages.map((m) => (
          <div
            key={m.id}
            className={
              m.fromSupport
                ? "rounded-brand border border-cream-300 bg-cream-50 px-3 py-2"
                : "rounded-brand border border-maroon-500/30 bg-orange-50 px-3 py-2"
            }
          >
            <p className="text-xs font-semibold text-ink-muted">
              {m.fromSupport ? "UNI8 support" : "You"} ·{" "}
              {new Date(m.createdAt).toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
            {m.attachments.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {m.attachments.map((a) =>
                  a.url ? (
                    <li key={a.id}>
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex rounded-brand border border-cream-300 bg-cream-100 px-2 py-1 text-xs font-medium text-maroon-600 underline"
                      >
                        {a.name}
                      </a>
                    </li>
                  ) : (
                    <li
                      key={a.id}
                      className="inline-flex rounded-brand border border-cream-300 px-2 py-1 text-xs text-ink-muted"
                    >
                      {a.name}
                    </li>
                  ),
                )}
              </ul>
            )}
          </div>
        ))}
      </section>

      <Card className="mt-6 flex flex-col gap-4">
        <CustomerTicketReply
          ticketId={ticket.id}
          closed={ticket.status === "closed"}
          canAttach={ticket.canAttach}
        />

        {isTerminal && <CustomerTicketReopen ticketId={ticket.id} />}

        {isTerminal && ticket.csatScore === null && <CustomerTicketCsat ticketId={ticket.id} />}

        {ticket.csatScore !== null && (
          <p className="text-sm text-ink-muted">
            You rated this support {ticket.csatScore} out of 5. Thanks.
          </p>
        )}
      </Card>
    </main>
  );
}
