import Link from "next/link";
import { requireRole } from "@/lib/auth/guards";
import { getMyRestaurants } from "@/lib/data/my-restaurants";
import { listVendorGrievances } from "@/lib/data/vendor-grievances";
import { Card } from "@/components/ui/card";
import { NewGrievanceForm } from "@/components/vendor/new-grievance-form";

/**
 * Vendor grievances list (SRS Phase 6: "Vendor grievance creation +
 * messaging to Super Admin"). Shows only the tickets this vendor raised —
 * enforced in Postgres by RLS (grievance_tickets_select_own_or_admin).
 */

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_review: "In review",
  waiting_customer: "Waiting on you",
  waiting_vendor: "Waiting on you",
  escalated: "Escalated",
  resolved: "Resolved",
  closed: "Closed",
};

export default async function VendorGrievancesPage() {
  const profile = await requireRole("vendor_admin");
  const [restaurants, tickets] = await Promise.all([
    getMyRestaurants(profile),
    listVendorGrievances(profile),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Grievances</h1>
        <NewGrievanceForm restaurants={restaurants} />
      </div>
      <p className="mt-2 text-sm text-ink-soft">
        Raise issues directly with UNI8 support. Only you and UNI8 can see these.
      </p>

      {tickets.length === 0 ? (
        <p className="mt-6 text-sm text-ink-soft">You haven't raised any grievances yet.</p>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {tickets.map((t) => (
            <Link key={t.id} href={`/vendor/grievances/${t.id}`}>
              <Card className="flex items-center justify-between hover:border-orange-400">
                <div>
                  <p className="font-semibold capitalize text-ink">{t.category.replace(/_/g, " ")}</p>
                  <p className="text-xs text-ink-soft">Opened {fmtDate(t.createdAt)}</p>
                </div>
                <span className="rounded-full bg-cream-200 px-3 py-1 text-xs font-medium text-ink-soft">
                  {STATUS_LABEL[t.status] ?? t.status}
                </span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
