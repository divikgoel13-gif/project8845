import { requireRole } from "@/lib/auth/guards";
import { getMyRestaurants } from "@/lib/data/my-restaurants";
import { getVendorAnalytics } from "@/lib/data/vendor-analytics";
import { Card } from "@/components/ui/card";
import { RestaurantSwitcher } from "@/components/vendor/restaurant-switcher";
import { paiseToRupeesDisplay } from "@/lib/money";

/**
 * Vendor Admin Analytics page (SRS Phase 4, §10 Analytics row: "GMV
 * trend; orders trend; AOV; orders by pickup period; top products;
 * collected vs cancelled/no-show; repeat-customer share"). See the doc
 * comment in lib/data/vendor-analytics.ts for the GMV/trend-basis
 * definitions this page's numbers rest on.
 */
export default async function VendorAnalyticsPage({
  searchParams,
}: {
  searchParams: { restaurant?: string };
}) {
  const profile = await requireRole("vendor_admin");
  const restaurants = await getMyRestaurants(profile);

  if (restaurants.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="mt-4 text-ink-soft">You aren't currently assigned to a restaurant.</p>
      </div>
    );
  }

  const selected = restaurants.find((r) => r.id === searchParams.restaurant)
    // restaurants is guaranteed non-empty by the length check above,
    // so restaurants[0] is a safe fallback.
    ?? restaurants[0]!;
  const analytics = await getVendorAnalytics(selected.id);
  const maxOrdersTrend = Math.max(...analytics.ordersTrend.map((p) => p.count), 1);

  return (
    <div>
      <h1 className="text-2xl font-bold">Analytics</h1>

      {restaurants.length > 1 && (
        <RestaurantSwitcher restaurants={restaurants} selectedId={selected.id} basePath="/vendor/analytics" />
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Metric label="GMV (14d)" value={paiseToRupeesDisplay(analytics.gmvPaise)} />
        <Metric label="AOV" value={paiseToRupeesDisplay(analytics.aovPaise)} />
        <Metric label="Repeat customers (30d)" value={`${analytics.repeatCustomerSharePercent}%`} />
        <Metric label="Collected" value={String(analytics.collectedVsCancelled.collected)} />
      </div>

      <Card className="mt-6">
        <h2 className="font-display font-semibold">Orders trend (30 days)</h2>
        <div className="mt-3 flex items-end gap-0.5" style={{ height: 96 }}>
          {analytics.ordersTrend.map((point) => (
            <div
              key={point.date}
              title={`${point.date}: ${point.count} orders`}
              className="flex-1 rounded-t bg-maroon-500"
              style={{ height: `${Math.max(4, Math.round((point.count / maxOrdersTrend) * 100))}%` }}
            />
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-muted">All orders (any status) placed per day, last 30 days.</p>
      </Card>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="font-display font-semibold">Collected vs. cancelled/no-show</h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            <li className="flex justify-between">
              <span className="text-ink-soft">Collected</span>
              <span className="font-medium">{analytics.collectedVsCancelled.collected}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-ink-soft">Cancelled / refunded</span>
              <span className="font-medium">{analytics.collectedVsCancelled.cancelled}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-ink-soft">No-show</span>
              <span className="font-medium">{analytics.collectedVsCancelled.noShow}</span>
            </li>
          </ul>
        </Card>

        <Card>
          <h2 className="font-display font-semibold">Orders by pickup hour (next 7 days)</h2>
          {analytics.pickupDemandByHour.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">No upcoming pickups scheduled.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-1">
              {analytics.pickupDemandByHour.map((slot) => (
                <li key={slot.hour} className="flex items-center gap-2 text-sm">
                  <span className="w-14 text-ink-soft">{slot.hour}:00</span>
                  <span className="h-2 rounded bg-orange-500" style={{ width: `${slot.count * 12}px` }} />
                  <span className="text-ink-muted">{slot.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <h2 className="font-display font-semibold">Top products (14 days)</h2>
        {analytics.topProducts.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">No sales in this window yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="pb-2 font-medium">Product</th>
                <th className="pb-2 font-medium">Qty sold</th>
                <th className="pb-2 font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {analytics.topProducts.map((p) => (
                <tr key={p.name} className="border-t border-cream-300">
                  <td className="py-2">{p.name}</td>
                  <td className="py-2">{p.quantitySold}</td>
                  <td className="py-2">{paiseToRupeesDisplay(p.revenuePaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 text-xl font-bold text-ink">{value}</p>
    </Card>
  );
}
