import Link from "next/link";
import { requireRole } from "@/lib/auth/guards";

/**
 * Shared Vendor Admin dashboard chrome (SRS Phase 4 deliverable list:
 * "Vendor Dashboard... Orders page... Products page... Manage Staff...").
 * This whole route group is Vendor-Admin-only — Staff have their own
 * separate app/(staff) route group with just Orders + Scan (SRS §11:
 * staff have "no product, price, payment, analytics, grievance or
 * settings access"), so there's no need to branch on role here.
 */
const VENDOR_ADMIN_NAV = [
  { href: "/vendor/dashboard", label: "Dashboard" },
  { href: "/vendor/orders", label: "Orders" },
  { href: "/vendor/analytics", label: "Analytics" },
  { href: "/vendor/products", label: "Products" },
  { href: "/vendor/staff", label: "Manage Staff" },
  { href: "/vendor/payments", label: "Payments" },
  { href: "/vendor/grievances", label: "Grievances" },
  { href: "/vendor/settings", label: "Settings" },
  { href: "/vendor/scan", label: "Scan" },
  { href: "/vendor/profile", label: "Profile" },
];

export default async function VendorLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireRole("vendor_admin");

  return (
    <div className="min-h-screen bg-cream-100">
      <header className="border-b border-cream-300 bg-cream-50">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <p className="font-display text-lg font-bold text-ink">UNI8 Vendor</p>
          <p className="text-sm text-ink-soft">{profile.name ?? profile.email}</p>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl grid-cols-[180px_1fr] gap-8 px-6 py-8">
        <nav className="flex flex-col gap-1">
          {VENDOR_ADMIN_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-brand px-3 py-2 text-sm font-medium text-ink-soft hover:bg-cream-200 hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <main>{children}</main>
      </div>
    </div>
  );
}
