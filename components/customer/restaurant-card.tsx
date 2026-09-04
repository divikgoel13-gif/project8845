import Link from "next/link";
import { Card } from "@/components/ui/card";
import { isRestaurantOrderable } from "@/lib/data/restaurants";
import type { RestaurantListItem } from "@/lib/data/restaurants";

export function RestaurantCard({ restaurant }: { restaurant: RestaurantListItem }) {
  const orderable = isRestaurantOrderable(restaurant);

  return (
    <Link href={`/restaurants/${restaurant.slug}`}>
      <Card className="flex flex-col gap-2 transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-lg font-bold">{restaurant.name}</h3>
          {!orderable && (
            <span className="whitespace-nowrap rounded-full bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning">
              Paused
            </span>
          )}
        </div>
        {restaurant.description && (
          <p className="text-sm text-ink-soft line-clamp-2">{restaurant.description}</p>
        )}
        {restaurant.location && <p className="text-xs text-ink-muted">{restaurant.location}</p>}
      </Card>
    </Link>
  );
}
