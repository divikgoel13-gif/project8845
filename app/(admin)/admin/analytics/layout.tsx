import { requireSuperAdmin } from "@/lib/auth/guards";
import { PageHeader } from "@/components/ui/page-header";
import { SectionNav, type NavGroup } from "@/components/ui/section-nav";

/**
 * Global Analytics shell (SRS Phase 9 "Global Analytics" and its six named
 * sub-reports: restaurant comparison, platform GMV/order/AOV, customer
 * retention/repeat-order, pickup demand, product performance, grievance
 * performance).
 *
 * Six report pages under one root, each owning its own queries — same
 * discipline as the restaurant workspace layout (Phase 7) and for the same
 * reason: a slow product-performance aggregate must not delay the overview
 * page rendering, and vice versa. `SectionNav` (not `AdminNav`, which is the
 * TOP-level twelve-destination rail) is the component built for exactly this
 * shape: a page with its own contextual sub-navigation, as used by the
 * restaurant workspace and Customer 360.
 *
 * `requireSuperAdmin()` runs here in addition to the `(admin)` layout's own
 * `requireRole("super_admin")`, matching the two-layer pattern documented on
 * that layout: redundant on the happy path, load-bearing if this route group
 * is ever reached directly.
 */
const GROUPS: NavGroup[] = [
  {
    group: "REPORTS",
    items: [
      { label: "Overview", href: "/admin/analytics" },
      { label: "Restaurants", href: "/admin/analytics/restaurants" },
      { label: "Retention", href: "/admin/analytics/retention" },
      { label: "Pickup demand", href: "/admin/analytics/pickup-demand" },
      { label: "Products", href: "/admin/analytics/products" },
      { label: "Grievances", href: "/admin/analytics/grievances" },
    ],
  },
];

export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  await requireSuperAdmin();

  return (
    <div>
      <PageHeader
        title="Global Analytics"
        description="Every figure here is aggregated live from source tables on each request — nothing is cached or pre-rolled, so it always reconciles with Orders, Payments and Grievances."
      />

      <div className="lg:grid lg:grid-cols-[180px_1fr] lg:gap-6">
        <SectionNav groups={GROUPS} className="mb-5 lg:mb-0" />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
