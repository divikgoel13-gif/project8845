import { requireRole } from "@/lib/auth/guards";
import { getMyRestaurants } from "@/lib/data/my-restaurants";
import { listRestaurantOrders } from "@/lib/data/vendor-orders";
import { OrderQueue } from "@/components/restaurant/order-queue";

const OPERATIONAL_STATUSES = ["scheduled", "preparing", "ready_for_pickup"] as const;

/**
 * Staff Orders page (SRS Phase 5: "Staff Orders page", "Upcoming order
 * visibility", "Pickup time visibility", "Operational order statuses").
 * Staff are scoped to exactly one restaurant (SRS §4) — no restaurant
 * switcher, unlike the Vendor Admin equivalent. Financial data is
 * withheld here (see components/restaurant/order-queue.tsx's doc
 * comment) and cancellation isn't offered — both per SRS §11.
 */
export default async function StaffOrdersPage() {
  const profile = await requireRole("staff");
  const restaurants = await getMyRestaurants(profile);
  const restaurant = restaurants[0];

  if (!restaurant) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Orders</h1>
        <p className="mt-4 text-ink-soft">You aren't currently assigned to a restaurant. Contact your Super Admin.</p>
      </div>
    );
  }

  const orders = await listRestaurantOrders(restaurant.id, { status: "all" });
  const upcoming = orders.filter((o) => OPERATIONAL_STATUSES.includes(o.status as (typeof OPERATIONAL_STATUSES)[number]));

  // Restaurant-specific operational alert (SRS Phase 5 deliverable) —
  // same 30-minute overdue threshold used in the Vendor Admin dashboard
  // (lib/data/vendor-analytics.ts), surfaced here too since Staff never
  // see that dashboard.
  const overdueCount = upcoming.filter(
    (o) => o.status === "ready_for_pickup" && o.pickupTime && new Date(o.pickupTime).getTime() < Date.now() - 30 * 60 * 1000
  ).length;

  return (
    <div>
      <h1 className="text-2xl font-bold">Orders — {restaurant.name}</h1>
      <p className="mt-1 text-sm text-ink-soft">
        {upcoming.length} order{upcoming.length === 1 ? "" : "s"} in the pipeline right now.
      </p>
      {overdueCount > 0 && (
        <div className="mt-3 rounded-brand bg-orange-100 px-4 py-2 text-sm text-orange-900">
          {overdueCount} order{overdueCount === 1 ? "" : "s"} ready and unclaimed 30+ minutes past pickup time.
        </div>
      )}
      <div className="mt-4">
        <OrderQueue restaurantId={restaurant.id} orders={upcoming} showFinancials={false} canCancel={false} />
      </div>
    </div>
  );
}
