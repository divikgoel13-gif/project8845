import Link from "next/link";

/**
 * Restaurant selector pills, used across every Vendor Admin page that
 * needs one (Dashboard, Orders, Analytics, Products, Staff). Extracted
 * from the pattern already established in app/(vendor)/vendor/scan/page.tsx
 * so it isn't copy-pasted five times. Deliberately a plain link-based
 * selector (?restaurant=<id>), not client state — works without JS,
 * link-shareable/bookmarkable per restaurant (SRS §3 general principle:
 * prefer server-rendered, URL-addressable state where reasonable).
 */
export function RestaurantSwitcher({
  restaurants,
  selectedId,
  basePath,
}: {
  restaurants: { id: string; name: string }[];
  selectedId: string;
  basePath: string;
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {restaurants.map((r) => (
        <Link
          key={r.id}
          href={`${basePath}?restaurant=${r.id}`}
          className={`rounded-full px-3 py-1 text-sm ${
            r.id === selectedId ? "bg-orange-500 text-cream-50" : "bg-cream-200 text-ink-soft"
          }`}
        >
          {r.name}
        </Link>
      ))}
    </div>
  );
}
