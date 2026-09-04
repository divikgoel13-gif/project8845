"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * Restaurant workspace section navigation (SRS §5.3).
 *
 * §5 explicitly rejects "one flat 12-item tab bar", and the workspace has
 * fourteen pages, so the groups are kept visible rather than flattened. On a
 * phone the strip scrolls horizontally — the alternative, a disclosure panel,
 * would mean two taps for every move between Orders and Products, which is the
 * pair an operator switches between most.
 *
 * Client component only because the active item needs `usePathname()`. There is
 * no state and no data fetching here.
 */

export type WorkspaceNavGroup = {
  group: string;
  items: { label: string; href: string }[];
};

export function RestaurantWorkspaceNav({ groups }: { groups: WorkspaceNavGroup[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Restaurant sections"
      className="-mx-4 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0"
    >
      <div className="flex w-max items-stretch gap-4 lg:w-full lg:flex-wrap">
        {groups.map(({ group, items }) => (
          <div key={group} className="flex flex-col gap-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{group}</p>
            <ul className="flex items-center gap-1">
              {items.map((item) => {
                const active = pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "block whitespace-nowrap rounded-brand px-2.5 py-1.5 text-xs font-semibold transition-colors",
                        active
                          ? "bg-maroon-500 text-cream-50"
                          : "bg-cream-100 text-ink-soft hover:bg-cream-200 hover:text-ink"
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
