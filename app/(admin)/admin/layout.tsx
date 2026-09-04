import Link from "next/link";

import { requireRole } from "@/lib/auth/guards";
import { AdminNav, type AdminNavGroup } from "@/components/admin/admin-nav";
import { getMaintenanceState } from "@/lib/platform/maintenance";

/**
 * Super Admin chrome (SRS §5.1).
 *
 * This array is a transcription of the §5.1 table, not a design choice: three
 * groups (COMMAND CENTER, PLATFORM, CONTROL) and exactly twelve destinations.
 * Phase 6 left nine of the twelve as inert placeholder labels; Phases 7–9 fill
 * them in, so every entry now has a real href.
 *
 * Nothing has been ADDED to the sidebar, deliberately. §5 opens with "The Super
 * Admin interface must not present every possible restaurant control as one flat
 * 12-item tab bar", so the V2 additions live UNDER the twelve rather than beside
 * them: Live Operations (§F) and Announcements (§O) are sections of Operations,
 * reconciliation (§T) sits under Payments, fraud review (§S) under Audit Log,
 * feature flags / maintenance mode (§Q, §R) under Settings. Growing this list to
 * seventeen would break the §5 information architecture it is meant to express.
 *
 * Deliberately NOT in this layout:
 *
 *  - A maintenance-mode gate. §R requires that "existing paid orders must remain
 *    accessible", and blocking the admin tree during a window would also lock the
 *    operator out of the switch they need to turn it back off. The banner below
 *    informs; `assertNotInMaintenance()` in each write action enforces.
 *
 *  - Any data fetching for the pages themselves. Each page owns its queries so a
 *    slow analytics aggregate cannot delay rendering the navigation.
 *
 * `requireRole("super_admin")` runs here as well as in every action, per the §17
 * layered model: the layout check makes the route group unreachable, the action
 * check makes the mutation unreachable. Neither substitutes for the other.
 */
const SIDEBAR: AdminNavGroup[] = [
  {
    group: "COMMAND CENTER",
    items: [
      { label: "Dashboard", href: "/admin/dashboard" },
      { label: "Orders", href: "/admin/orders" },
      { label: "Customers", href: "/admin/customers" },
      { label: "Restaurants", href: "/admin/restaurants" },
      { label: "Payments", href: "/admin/payments" },
      { label: "Grievances", href: "/admin/grievances" },
      { label: "Analytics", href: "/admin/analytics" },
    ],
  },
  {
    group: "PLATFORM",
    items: [
      { label: "Staff & Access", href: "/admin/staff-access" },
      { label: "Menus", href: "/admin/menus" },
      { label: "Operations", href: "/admin/operations" },
      { label: "Settings", href: "/admin/settings" },
    ],
  },
  {
    group: "CONTROL",
    items: [{ label: "Audit Log", href: "/admin/audit" }],
  },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireRole("super_admin");
  const maintenance = await getMaintenanceState();

  return (
    <div className="min-h-screen bg-cream-100">
      <header className="border-b border-cream-300 bg-cream-50">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4">
          <Link href="/admin/dashboard" className="font-display text-base font-bold text-ink sm:text-lg">
            UNI8 Admin
          </Link>
          <p className="truncate text-xs text-ink-soft sm:text-sm">{profile.name ?? profile.email}</p>
        </div>
      </header>

      {/*
        Maintenance banner. Shown to the operator who can act on it, with the
        message they themselves wrote, so the state of the platform is never
        something they have to remember having set.
      */}
      {maintenance?.isActive ? (
        <div className="border-b border-warning bg-warning-bg">
          <div className="mx-auto max-w-7xl px-4 py-2 text-xs text-warning sm:px-6 sm:text-sm">
            <span className="font-semibold">Maintenance mode is active.</span>{" "}
            {maintenance.message?.trim()
              ? maintenance.message
              : "Customer write actions are blocked. Existing paid orders remain accessible."}{" "}
            <Link href="/admin/settings" className="font-semibold underline">
              Manage
            </Link>
          </div>
        </div>
      ) : null}

      {/*
        Phone-first per §27: one column with the nav collapsed above the content,
        becoming a 220px rail only from `lg`. The old fixed grid-cols-[200px_1fr]
        forced a 200px column onto a 360px viewport.
      */}
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8 lg:grid lg:grid-cols-[220px_1fr] lg:gap-8">
        <AdminNav groups={SIDEBAR} />
        <main className="mt-5 min-w-0 lg:mt-0">{children}</main>
      </div>
    </div>
  );
}
