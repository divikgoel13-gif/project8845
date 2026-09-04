"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * Super Admin primary navigation (SRS §5.1).
 *
 * Two requirements pull in opposite directions here. §5.1 fixes the information
 * architecture — three named groups, COMMAND CENTER / PLATFORM / CONTROL, with
 * twelve destinations — while §27 requires every dashboard, "including Super
 * Admin", to be usable phone-first. A twelve-item fixed 200px rail satisfies the
 * first and fails the second, which is what the Phase 6 layout did.
 *
 * The resolution: identical link data, two presentations. Below `lg` the rail
 * collapses into a disclosure panel behind a "Menu" button, so a phone gets the
 * full 100vw for the table it came to read. From `lg` up the grouped rail is
 * always visible, since that is genuinely the faster way to move around twelve
 * pages on a laptop.
 *
 * Client component because it needs `usePathname()` twice over: to mark the
 * active item, and to close the mobile panel on navigation. Without the latter
 * the panel would stay open covering the page you just asked for.
 */

export type AdminNavGroup = {
  group: string;
  items: { label: string; href: string }[];
};

export function AdminNav({ groups }: { groups: AdminNavGroup[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close on navigation. Effect rather than an onClick on each Link so that
  // back/forward and programmatic navigation also close it.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const current = findCurrentLabel(groups, pathname);

  return (
    <>
      {/* Phone / tablet: disclosure. */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="admin-nav-panel"
          className="flex w-full items-center justify-between rounded-brand border border-cream-300 bg-cream-50 px-4 py-3 text-left"
        >
          <span className="text-sm font-semibold text-ink">
            {current ?? "Admin"}
          </span>
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {open ? "Close" : "Menu"}
          </span>
        </button>

        {open ? (
          <nav
            id="admin-nav-panel"
            aria-label="Admin navigation"
            className="mt-2 flex flex-col gap-4 rounded-brand border border-cream-300 bg-cream-50 p-4"
          >
            {groups.map(({ group, items }) => (
              <div key={group}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{group}</p>
                <ul className="mt-1.5 grid grid-cols-2 gap-1 sm:grid-cols-3">
                  {items.map((item) => (
                    <li key={item.href}>
                      <NavLink item={item} pathname={pathname} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        ) : null}
      </div>

      {/* Laptop and up: persistent grouped rail. */}
      <nav aria-label="Admin navigation" className="hidden lg:flex lg:flex-col lg:gap-6">
        {groups.map(({ group, items }) => (
          <div key={group}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{group}</p>
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} pathname={pathname} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}

function NavLink({
  item,
  pathname,
}: {
  item: { label: string; href: string };
  pathname: string | null;
}) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "block rounded-brand px-2.5 py-2 text-sm lg:py-1.5",
        active
          ? "bg-maroon-500 font-semibold text-cream-50"
          : "font-medium text-ink-soft hover:bg-cream-200 hover:text-ink"
      )}
    >
      {item.label}
    </Link>
  );
}

/**
 * Prefix matching, so /admin/restaurants/<id>/products still highlights
 * "Restaurants". /admin/dashboard is matched exactly because every other admin
 * route would otherwise have to be checked against it first.
 */
function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}

/**
 * The label of the section currently open, shown on the collapsed mobile button.
 * A closed menu that says only "Menu" loses the "where am I" cue the rail gives
 * for free. Longest match wins so a nested route resolves to the deepest section.
 */
function findCurrentLabel(groups: AdminNavGroup[], pathname: string | null): string | null {
  let best: { label: string; length: number } | null = null;
  for (const { items } of groups) {
    for (const item of items) {
      if (!isActive(pathname, item.href)) continue;
      if (!best || item.href.length > best.length) {
        best = { label: item.label, length: item.href.length };
      }
    }
  }
  return best?.label ?? null;
}
