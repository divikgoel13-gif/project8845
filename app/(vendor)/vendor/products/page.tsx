import { requireRole } from "@/lib/auth/guards";
import { getMyRestaurants } from "@/lib/data/my-restaurants";
import { getRestaurantProductsForVendor } from "@/lib/data/products";
import { RestaurantSwitcher } from "@/components/vendor/restaurant-switcher";
import { ProductManager } from "@/components/vendor/product-manager";

/**
 * Vendor Admin Products page (SRS Phase 4, §10 Products row). Thin
 * server wrapper: fetch data server-side, hand off to the ProductManager
 * client island for all the create/edit/archive interactivity.
 */
export default async function VendorProductsPage({
  searchParams,
}: {
  searchParams: { restaurant?: string };
}) {
  const profile = await requireRole("vendor_admin");
  const restaurants = await getMyRestaurants(profile);

  if (restaurants.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Products</h1>
        <p className="mt-4 text-ink-soft">You aren't currently assigned to a restaurant.</p>
      </div>
    );
  }

  const selected = restaurants.find((r) => r.id === searchParams.restaurant)
    // restaurants is guaranteed non-empty by the length check above,
    // so restaurants[0] is a safe fallback.
    ?? restaurants[0]!;
  const { categories, products } = await getRestaurantProductsForVendor(selected.id);

  return (
    <div>
      <h1 className="text-2xl font-bold">Products</h1>

      {restaurants.length > 1 && (
        <RestaurantSwitcher restaurants={restaurants} selectedId={selected.id} basePath="/vendor/products" />
      )}

      <div className="mt-6">
        <ProductManager restaurantId={selected.id} categories={categories} products={products} />
      </div>
    </div>
  );
}
