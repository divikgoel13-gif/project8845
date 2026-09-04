"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * Contextual sub-navigation.
 *
 * SRS §5.3 is explicit that the restaurant workspace must use "grouped
 * contextual navigation", and the Phase 7 completion standard says the
 * workspace must be "contextual, not a flat cluttered tab list". Fourteen
 * pages laid out as one row of tabs is exactly the flat cluttered list the SRS
 * rules out, so this component renders SECTION GROUPS (OVERVIEW, OPERATIONS,
 * PEOPLE & ACCESS, FINANCE, CUSTOMER EXPERIENCE, CONFIGURATION, SYSTEM) with
 * the active item marked.
 *
 * It is a client component only because it needs `usePathname()` to decide
 * which item is active. Deriving that on the server would mean threading the
 * current path through every page, and Next.js does not give a server
 * component the current URL.
 *
 * Layout: horizontal scrolling group strip on a phone, vertical rail from
 * `lg` up (SRS §27 phone-first).
 *
 * NOTE for the restaurant workspace: that workspace uses
 * `components/admin/restaurant-workspace-nav.tsx` instead, because its groups
 * live INSIDE the §5.3 permanent context header and must stay horizontal at
 * every width — the admin shell already spends the left rail on the twelve
 * global destinations, and two vertical rails side by side leaves no room for a
 * table. This component remains the shape for any future page that owns its own
 * left rail (Customer 360 was designed against it).
 */
export type NavGroup = {
  group: string;
  items: { label: string; href: string }[];
};

export function SectionNav({ groups, className }: { groups: NavGroup[]; className?: string }) {
  const pathname = usePathname();
  const activeHref = resolveActiveHref(pathname, groups);

  return (
    <nav className={cn("lg:flex lg:flex-col lg:gap-5", className)} aria-label="Section navigation">
      {/* Phone/tablet: one scrollable row per group, labels inline. */}
      <div className="flex flex-col gap-3 lg:hidden">
        {groups.map(({ group, items }) => (
          <div key={group}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{group}</p>
            <div className="-mx-4 mt-1 flex gap-1.5 overflow-x-auto px-4 pb-1">
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={item.href === activeHref ? "page" : undefined}
                  className={cn(
                    "whitespace-nowrap rounded-brand px-3 py-1.5 text-xs font-semibold",
                    item.href === activeHref
                      ? "bg-maroon-500 text-cream-50"
                      : "bg-cream-50 text-ink-soft hover:bg-cream-200"
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Laptop and up: vertical grouped rail. */}
      <div className="hidden lg:flex lg:flex-col lg:gap-5">
        {groups.map(({ group, items }) => (
          <div key={group}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{group}</p>
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={item.href === activeHref ? "page" : undefined}
                    className={cn(
                      "block rounded-brand px-2.5 py-1.5 text-sm",
                      item.href === activeHref
                        ? "bg-cream-200 font-semibold text-ink"
                        : "font-medium text-ink-soft hover:bg-cream-200 hover:text-ink"
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

/**
 * Resolves which single item is "active" by longest-prefix match across
 * EVERY item in every group, not per-item in isolation. A per-item check
 * ("does the path start with my href + '/'") looked sufficient until a
 * group actually shipped a base-path item alongside its own children —
 * Global Analytics is that first case: "Overview" lives at `/admin/analytics`
 * and "Restaurants" at `/admin/analytics/restaurants`, and the latter path
 * also satisfies the former's prefix test. Picking the longest matching href
 * rather than marking every satisfied item active means exactly one section
 * is ever highlighted, which is what "aria-current=page" is supposed to mean.
 */
function resolveActiveHref(pathname: string | null, groups: NavGroup[]): string | null {
  if (!pathname) return null;
  let best: string | null = null;
  for (const { items } of groups) {
    for (const { href } of items) {
      const matches = pathname === href || pathname.startsWith(`${href}/`);
      if (matches && (!best || href.length > best.length)) best = href;
    }
  }
  return best;
}
