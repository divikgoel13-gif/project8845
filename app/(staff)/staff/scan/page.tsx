import { requireRole } from "@/lib/auth/guards";
import { getMyRestaurants } from "@/lib/data/my-restaurants";
import { ScanForm } from "@/components/restaurant/scan-form";

/**
 * Staff Scan page (SRS §11: "Exactly two tabs: Orders and Scan... Scan
 * verifies QR and marks eligible order collected"). Staff are scoped to
 * exactly one restaurant (SRS §4), so there's no restaurant selector here
 * — unlike the Vendor Admin scan page, which may cover several.
 */
export default async function StaffScanPage() {
  const profile = await requireRole("staff");
  const restaurants = await getMyRestaurants(profile);
  const restaurant = restaurants[0];

  if (!restaurant) {
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-bold">Scan</h1>
        <p className="mt-4 text-ink-soft">
          You aren't currently assigned to a restaurant. Contact your Super Admin.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold">Scan — {restaurant.name}</h1>
      <div className="mt-6">
        <ScanForm restaurantId={restaurant.id} />
      </div>
    </div>
  );
}
