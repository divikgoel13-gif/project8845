import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";
import { getVendorGrievance } from "@/lib/data/vendor-grievances";
import { Card } from "@/components/ui/card";
import { VendorGrievanceReply } from "@/components/vendor/vendor-grievance-reply";

/**
 * Vendor grievance thread (SRS Phase 6: messaging to Super Admin). Internal
 * UNI8 notes are stripped by RLS before they ever reach this page.
 */

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default async function VendorGrievanceDetailPage({ params }: { params: { id: string } }) {
  const profile = await requireRole("vendor_admin");
  const ticket = await getVendorGrievance(profile, params.id);

  if (!ticket) notFound();

  return (
    <div>
      <Link href="/vendor/grievances" className="text-sm text-orange-600 underline">
        ← All grievances
      </Link>

      <div className="mt-3 flex items-center justify-between">
        <h1 className="text-2xl font-bold capitalize">{ticket.category.replace(/_/g, " ")}</h1>
        <span className="rounded-full bg-cream-200 px-3 py-1 text-xs font-medium capitalize text-ink-soft">
          {ticket.status.replace(/_/g, " ")}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-soft">Opened {fmtDate(ticket.createdAt)}</p>

      {ticket.resolutionNote && (
        <Card className="mt-4 border-success bg-cream-50">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Resolution</p>
          <p className="mt-1 text-sm text-ink">{ticket.resolutionNote}</p>
        </Card>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {ticket.messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[85%] rounded-brand px-3 py-2 text-sm ${
              m.fromSuperAdmin
                ? "self-start bg-cream-200 text-ink"
                : "self-end bg-orange-500 text-cream-50"
            }`}
          >
            <p className="whitespace-pre-wrap">{m.body}</p>
            <p className={`mt-1 text-[10px] ${m.fromSuperAdmin ? "text-ink-soft" : "text-cream-100"}`}>
              {m.fromSuperAdmin ? "UNI8 Support" : "You"} · {fmtDate(m.createdAt)}
            </p>
          </div>
        ))}
      </div>

      <VendorGrievanceReply ticketId={ticket.id} closed={ticket.status === "closed"} />
    </div>
  );
}
