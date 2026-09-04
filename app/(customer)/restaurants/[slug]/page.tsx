import { notFound } from "next/navigation";
import { getRestaurantBySlug, isRestaurantOrderable } from "@/lib/data/restaurants";
import { getRestaurantMenu } from "@/lib/data/products";
import { ProductCard } from "@/components/customer/product-card";

export default async function RestaurantMenuPage({ params }: { params: { slug: string } }) {
  const restaurant = await getRestaurantBySlug(params.slug);
  if (!restaurant) notFound();

  const menu = await getRestaurantMenu(restaurant.id);
  const orderable = isRestaurantOrderable(restaurant);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-bold">{restaurant.name}</h1>
      {restaurant.description && <p className="mt-1 text-ink-soft">{restaurant.description}</p>}

      {!orderable && (
        <div className="mt-4 rounded-brand bg-warning-bg px-4 py-3 text-sm text-warning">
          {restaurant.paused_reason || "This restaurant isn't accepting orders right now — you can still browse the menu."}
        </div>
      )}

      <div className="mt-8 flex flex-col gap-8">
        {menu.map((category) => (
          <section key={category.id}>
            <h2 className="mb-3 text-lg font-semibold">{category.name}</h2>
            <div className="flex flex-col gap-3">
              {category.products.map((product) => (
                <ProductCard key={product.id} product={product} orderable={orderable} />
              ))}
            </div>
          </section>
        ))}
        {menu.every((c) => c.products.length === 0) && (
          <p className="text-ink-soft">No items available right now.</p>
        )}
      </div>
    </main>
  );
}
