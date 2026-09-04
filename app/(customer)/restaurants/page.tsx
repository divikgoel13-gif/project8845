import { listDiscoverableRestaurants } from "@/lib/data/restaurants";
import { RestaurantCard } from "@/components/customer/restaurant-card";

/**
 * Restaurant discovery/search (SRS §9 Discovery, Phase 2). Search is a
 * plain server-rendered form using a query string (?q=) so the page works
 * without client JS and is trivially cacheable/shareable — no need for a
 * client-side search-as-you-type widget for a V1 campus restaurant count.
 */
export default async function RestaurantsPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const restaurants = await listDiscoverableRestaurants(searchParams.q);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-bold">Restaurants</h1>
      <form className="mt-4">
        <input
          type="search"
          name="q"
          defaultValue={searchParams.q}
          placeholder="Search restaurants..."
          className="w-full rounded-brand border border-cream-300 bg-cream-50 px-4 py-2.5"
        />
      </form>

      {restaurants.length === 0 ? (
        <p className="mt-8 text-ink-soft">No restaurants found.</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {restaurants.map((r) => (
            <RestaurantCard key={r.id} restaurant={r} />
          ))}
        </div>
      )}
    </main>
  );
}
