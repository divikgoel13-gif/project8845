import Link from "next/link";
import { requireProfile } from "@/lib/auth/guards";
import { listCustomerTickets } from "@/lib/data/customer-grievances";
import { Card } from "@/components/ui/card";
import { Badge, grievanceStatusTone } from "@/components/ui/badge";
import { humanise } from "@/lib/admin/format";

export const dynamic = "force-dynamic";

/**
 * The customer's support list (SRS V2 §I, V2.6 §59 "the customer can follow the
 * resulting ticket").
 *
 * This is deliberately a follow-along view, not a help desk: there is no "new
 * ticket" button here. §I ties every issue to an order — "a Need Help / Report
 * an Issue action on the relevant order" — because a ticket with an order
 * attached is one support can act on and a free-form ticket is one they have to
 * interview the customer about first. So creation lives on the order screen and
 * this page links back to it.
 */
export default async function CustomerSupportPage() {
  const profile = await requireProfile();
  const tickets = await listCustomerTickets(profile.id);

  const live = tickets.filter((t) => t.status !== "resolved" && t.status !== "closed");
  const past = tickets.filter((t) => t.status === "resolved" || t.status === "closed");

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-bold">Support</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Tickets you have raised with UNI8. To report a problem with an order, open the order and use
        &ldquo;Need help with this order?&rdquo;.
      </p>

      {tickets.length === 0 ? (
        <Card className="mt-6">
          <p className="text-sm text-ink-soft">
            You haven&apos;t raised anything with us.{" "}
            <Link href="/orders" className="font-semibold text-maroon-600 underline">
              Your orders
            </Link>
          </p>
        </Card>
      ) : (
        <>
          {live.length > 0 && (
            <section className="mt-6">
              <h2 className="font-display text-lg font-bold">Open</h2>
              <div className="mt-3 flex flex-col gap-3">
                {live.map((t) => (
                  <TicketRow key={t.id} ticket={t} />
                ))}
              </div>
            </section>
          )}

          {past.length > 0 && (
            <section className="mt-8">
              <h2 className="font-display text-lg font-bold">Closed</h2>
              <div className="mt-3 flex flex-col gap-3">
                {past.map((t) => (
                  <TicketRow key={t.id} ticket={t} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function TicketRow({
  ticket,
}: {
  ticket: {
    id: string;
    ticketNo: number | null;
    category: string;
    status: string;
    updatedAt: string;
    restaurantName: string | null;
    resolvedAt: string | null;
    csatScore: number | null;
  };
}) {
  return (
    <Link href={`/support/${ticket.id}`}>
      <Card className="transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">
              {ticket.ticketNo ? `#${ticket.ticketNo} · ` : ""}
              {humanise(ticket.category)}
            </p>
            <p className="mt-0.5 truncate text-xs text-ink-muted">
              {ticket.restaurantName ?? "UNI8"} ·{" "}
              {new Date(ticket.updatedAt).toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          </div>
          <Badge tone={grievanceStatusTone(ticket.status)}>{humanise(ticket.status)}</Badge>
        </div>
        {ticket.resolvedAt && ticket.csatScore === null && (
          <p className="mt-2 text-xs text-orange-600">Resolved — tap to rate the support you got.</p>
        )}
      </Card>
    </Link>
  );
}
