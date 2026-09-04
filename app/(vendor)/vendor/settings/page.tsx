import { requireRole } from "@/lib/auth/guards";
import { getMyRestaurants } from "@/lib/data/my-restaurants";
import { getRestaurantOperationsSettings } from "@/lib/data/vendor-restaurant-settings";
import { RestaurantSwitcher } from "@/components/vendor/restaurant-switcher";
import { RestaurantSettingsManager } from "@/components/vendor/restaurant-settings-manager";

/**
 * Vendor Admin restaurant operations settings page (SRS Phase 5).
 */
export default async function VendorSettingsPage({
  searchParams,
}: {
  searchParams: { restaurant?: string };
}) {
  const profile = await requireRole("vendor_admin");
  const restaurants = await getMyRestaurants(profile);

  if (restaurants.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-4 text-ink-soft">You aren't currently assigned to a restaurant.</p>
      </div>
    );
  }

  const selected = restaurants.find((r) => r.id === searchParams.restaurant)
    // restaurants is guaranteed non-empty by the length check above,
    // so restaurants[0] is a safe fallback.
    ?? restaurants[0]!;
  const settings = await getRestaurantOperationsSettings(selected.id);

  return (
    <div>
      <h1 className="text-2xl font-bold">Settings</h1>

      {restaurants.length > 1 && (
        <RestaurantSwitcher restaurants={restaurants} selectedId={selected.id} basePath="/vendor/settings" />
      )}

      <div className="mt-6">
        {settings ? (
          <RestaurantSettingsManager restaurantId={selected.id} settings={settings} />
        ) : (
          <p className="text-sm text-ink-soft">Could not load settings for this restaurant.</p>
        )}
      </div>
    </div>
  );
}
