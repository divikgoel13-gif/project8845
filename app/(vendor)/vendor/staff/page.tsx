import { requireRole } from "@/lib/auth/guards";
import { getMyRestaurants } from "@/lib/data/my-restaurants";
import { listRestaurantStaff } from "@/lib/data/vendor-staff";
import { RestaurantSwitcher } from "@/components/vendor/restaurant-switcher";
import { StaffManager } from "@/components/vendor/staff-manager";

export default async function VendorStaffPage({
  searchParams,
}: {
  searchParams: { restaurant?: string };
}) {
  const profile = await requireRole("vendor_admin");
  const restaurants = await getMyRestaurants(profile);

  if (restaurants.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Manage staff</h1>
        <p className="mt-4 text-ink-soft">You aren't currently assigned to a restaurant.</p>
      </div>
    );
  }

  const selected = restaurants.find((r) => r.id === searchParams.restaurant)
    // restaurants is guaranteed non-empty by the length check above,
    // so restaurants[0] is a safe fallback.
    ?? restaurants[0]!;
  const staff = await listRestaurantStaff(selected.id);

  return (
    <div>
      <h1 className="text-2xl font-bold">Manage staff</h1>

      {restaurants.length > 1 && (
        <RestaurantSwitcher restaurants={restaurants} selectedId={selected.id} basePath="/vendor/staff" />
      )}

      <div className="mt-6">
        <StaffManager restaurantId={selected.id} staff={staff} />
      </div>
    </div>
  );
}
