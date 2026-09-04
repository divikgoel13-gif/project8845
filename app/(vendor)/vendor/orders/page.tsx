import { requireRole } from "@/lib/auth/guards";
import { getMyRestaurants } from "@/lib/data/my-restaurants";
import { listRestaurantOrders, type VendorOrderStatus } from "@/lib/data/vendor-orders";
import { RestaurantSwitcher } from "@/components/vendor/restaurant-switcher";
import { OrderQueue } from "@/components/restaurant/order-queue";

const STATUS_FILTERS: { value: VendorOrderStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "paid", label: "Paid" },
  { value: "scheduled", label: "Scheduled" },
  { value: "preparing", label: "Preparing" },
  { value: "ready_for_pickup", label: "Ready" },
  { value: "collected", label: "Collected" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No-show" },
];

/**
 * Vendor Admin Orders page (SRS §10 Orders row: search/filter/date/
 * pickup/collection status and full details; Phase 5's "Operational
 * order statuses" deliverable added the actual status-transition
 * buttons via the shared OrderQueue component — before that, nothing
 * anywhere let an order move past "scheduled"). Filters remain plain
 * query-string params — see the original Phase 4 comment on why.
 */
export default async function VendorOrdersPage({
  searchParams,
}: {
  searchParams: { restaurant?: string; status?: string; search?: string; date?: string };
}) {
  const profile = await requireRole("vendor_admin");
  const restaurants = await getMyRestaurants(profile);

  if (restaurants.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Orders</h1>
        <p className="mt-4 text-ink-soft">You aren't currently assigned to a restaurant.</p>
      </div>
    );
  }

  const selected = restaurants.find((r) => r.id === searchParams.restaurant)
    // restaurants is guaranteed non-empty by the length check above,
    // so restaurants[0] is a safe fallback.
    ?? restaurants[0]!;
  const status = (searchParams.status as VendorOrderStatus | "all" | undefined) ?? "all";

  const orders = await listRestaurantOrders(selected.id, {
    status,
    search: searchParams.search,
    pickupDate: searchParams.date,
  });

  const paramsFor = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    params.set("restaurant", selected.id);
    if (status !== "all") params.set("status", status);
    if (searchParams.search) params.set("search", searchParams.search);
    if (searchParams.date) params.set("date", searchParams.date);
    for (const [key, value] of Object.entries(overrides)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    return params.toString();
  };

  return (
    <div>
      <h1 className="text-2xl font-bold">Orders</h1>

      {restaurants.length > 1 && (
        <RestaurantSwitcher restaurants={restaurants} selectedId={selected.id} basePath="/vendor/orders" />
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <a
            key={f.value}
            href={`/vendor/orders?${paramsFor({ status: f.value === "all" ? undefined : f.value })}`}
            className={`rounded-full px-3 py-1 text-sm ${
              status === f.value ? "bg-maroon-500 text-cream-50" : "bg-cream-200 text-ink-soft"
            }`}
          >
            {f.label}
          </a>
        ))}
      </div>

      <form action="/vendor/orders" method="GET" className="mt-4 flex flex-wrap gap-2">
        <input type="hidden" name="restaurant" value={selected.id} />
        {status !== "all" && <input type="hidden" name="status" value={status} />}
        <input
          type="search"
          name="search"
          defaultValue={searchParams.search ?? ""}
          placeholder="Search customer name or phone"
          className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
        />
        <input
          type="date"
          name="date"
          defaultValue={searchParams.date ?? ""}
          className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded-brand bg-orange-500 px-4 py-2 text-sm font-semibold text-cream-50">
          Filter
        </button>
      </form>

      <div className="mt-6">
        <OrderQueue restaurantId={selected.id} orders={orders} showFinancials={true} canCancel={true} />
      </div>
    </div>
  );
}
