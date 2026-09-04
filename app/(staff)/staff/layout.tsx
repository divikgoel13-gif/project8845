import Link from "next/link";
import { requireRole } from "@/lib/auth/guards";

/**
 * Staff portal chrome — deliberately exactly two links, matching SRS §11:
 * "Staff has only Orders + Scan permissions. Staff cannot access vendor
 * finances or customer information beyond what is operationally
 * required." There is no third link here on purpose; that boundary is
 * enforced structurally (nothing else is reachable from this nav), not
 * just documented.
 */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireRole("staff");

  return (
    <div className="min-h-screen bg-cream-100">
      <header className="border-b border-cream-300 bg-cream-50">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <p className="font-display text-lg font-bold text-ink">UNI8 Staff</p>
          <p className="text-sm text-ink-soft">{profile.name ?? profile.email}</p>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-6 py-8">
        <nav className="mb-6 flex gap-2">
          <Link href="/staff/orders" className="rounded-full bg-cream-200 px-4 py-2 text-sm font-medium text-ink-soft hover:bg-cream-300">
            Orders
          </Link>
          <Link href="/staff/scan" className="rounded-full bg-cream-200 px-4 py-2 text-sm font-medium text-ink-soft hover:bg-cream-300">
            Scan
          </Link>
        </nav>
        <main>{children}</main>
      </div>
    </div>
  );
}
