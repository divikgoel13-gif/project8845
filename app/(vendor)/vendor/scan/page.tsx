import { requireRole } from "@/lib/auth/guards";
import { getMyRestaurants } from "@/lib/data/my-restaurants";
import { ScanForm } from "@/components/restaurant/scan-form";

/**
 * Vendor Admin Scan page (SRS §10: "Scan Orders — Vendor Admin can scan
 * QRs"). A Vendor Admin may be assigned to more than one restaurant
 * (unlike Staff), so this needs a restaurant selector when there's more
 * than one — implemented as a plain query-string param (?restaurant=)
 * rather than client state, so the page works without JS and is
 * link-shareable/bookmarkable per restaurant.
 */
export default async function VendorScanPage({ searchParams }: { searchParams: { restaurant?: string } }) {
  const profile = await requireRole("vendor_admin");
  const restaurants = await getMyRestaurants(profile);

  if (restaurants.length === 0) {
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-bold">Scan</h1>
        <p className="mt-4 text-ink-soft">You aren't currently assigned to a restaurant.</p>
      </div>
    );
  }

  const selected = restaurants.find((r) => r.id === searchParams.restaurant)
    // restaurants is guaranteed non-empty by the length check above,
    // so restaurants[0] is a safe fallback.
    ?? restaurants[0]!;

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold">Scan</h1>

      {restaurants.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {restaurants.map((r) => (
            <a
              key={r.id}
              href={`/vendor/scan?restaurant=${r.id}`}
              className={`rounded-full px-3 py-1 text-sm ${r.id === selected.id ? "bg-orange-500 text-cream-50" : "bg-cream-200 text-ink-soft"}`}
            >
              {r.name}
            </a>
          ))}
        </div>
      )}

      <div className="mt-6">
        <ScanForm restaurantId={selected.id} />
      </div>
    </div>
  );
}
