import { requireRole } from "@/lib/auth/guards";
import { getMyRestaurants } from "@/lib/data/my-restaurants";
import { getVendorDashboardMetrics } from "@/lib/data/vendor-analytics";
import { Card } from "@/components/ui/card";
import { paiseToRupeesDisplay } from "@/lib/money";
import { RestaurantSwitcher } from "@/components/vendor/restaurant-switcher";

/**
 * Vendor Admin Dashboard (SRS Phase 4, §10 Dashboard row: "GMV, orders,
 * AOV, upcoming pickups, collected/pending, sales trend, pickup demand,
 * top products and alerts"). Restaurant selection follows the same
 * ?restaurant= query-param convention as the existing Scan page, for the
 * same reason: works without client JS, link-shareable/bookmarkable.
 */
export default async function VendorDashboardPage({
  searchParams,
}: {
  searchParams: { restaurant?: string };
}) {
  const profile = await requireRole("vendor_admin");
  const restaurants = await getMyRestaurants(profile);

  if (restaurants.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="mt-4 text-ink-soft">You aren't currently assigned to a restaurant.</p>
      </div>
    );
  }

  const selected = restaurants.find((r) => r.id === searchParams.restaurant)
    // restaurants is guaranteed non-empty by the length check above,
    // so restaurants[0] is a safe fallback.
    ?? restaurants[0]!;
  const metrics = await getVendorDashboardMetrics(selected.id);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
      </div>

      {restaurants.length > 1 && (
        <RestaurantSwitcher restaurants={restaurants} selectedId={selected.id} basePath="/vendor/dashboard" />
      )}

      {metrics.alerts.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {metrics.alerts.map((alert) => (
            <div key={alert.type} className="rounded-brand bg-orange-100 px-4 py-2 text-sm text-orange-900">
              {alert.message}
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Metric label="GMV (14d)" value={paiseToRupeesDisplay(metrics.gmvPaise)} />
        <Metric label="Orders (14d)" value={String(metrics.orderCount)} />
        <Metric label="AOV" value={paiseToRupeesDisplay(metrics.aovPaise)} />
        <Metric label="Upcoming pickups (7d)" value={String(metrics.upcomingPickupCount)} />
        <Metric label="Collected" value={String(metrics.collectedCount)} />
        <Metric label="Pending" value={String(metrics.pendingCount)} />
        <Metric label="Outstanding value" value={paiseToRupeesDisplay(metrics.outstandingPaise)} />
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="font-display font-semibold">Sales trend (14 days)</h2>
          <div className="mt-3 flex items-end gap-1" style={{ height: 96 }}>
            {metrics.salesTrend.map((point) => {
              const max = Math.max(...metrics.salesTrend.map((p) => p.gmvPaise), 1);
              const heightPercent = Math.max(4, Math.round((point.gmvPaise / max) * 100));
              return (
                <div
                  key={point.date}
                  title={`${point.date}: ${paiseToRupeesDisplay(point.gmvPaise)}`}
                  className="flex-1 rounded-t bg-orange-500"
                  style={{ height: `${heightPercent}%` }}
                />
              );
            })}
          </div>
          <p className="mt-2 text-xs text-ink-muted">Bars are daily GMV over the last 14 days.</p>
        </Card>

        <Card>
          <h2 className="font-display font-semibold">Pickup demand (next 7 days, by hour)</h2>
          {metrics.pickupDemandByHour.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">No upcoming pickups scheduled.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-1">
              {metrics.pickupDemandByHour.map((slot) => (
                <li key={slot.hour} className="flex items-center gap-2 text-sm">
                  <span className="w-14 text-ink-soft">{slot.hour}:00</span>
                  <span className="h-2 rounded bg-maroon-500" style={{ width: `${slot.count * 12}px` }} />
                  <span className="text-ink-muted">{slot.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <h2 className="font-display font-semibold">Top products (14 days)</h2>
        {metrics.topProducts.length === 0 ? (
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
              {metrics.topProducts.map((p) => (
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
