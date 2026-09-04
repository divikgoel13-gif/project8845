import { requireSuperAdmin } from "@/lib/auth/guards";
import { getRestaurantComparison, type RestaurantComparisonSort, ANALYTICS_RANGE_DAYS, type AnalyticsRangeDays } from "@/lib/admin/analytics";
import { toCsvDownload, csvResponseHeaders, csvFilename, csvPaise, type CsvColumn } from "@/lib/admin/csv";
import { recordAuditEvent } from "@/lib/audit/log";
import type { RestaurantComparisonRow } from "@/lib/admin/analytics";

/**
 * Restaurant comparison export (SRS Phase 9 "Search/filter/export
 * capabilities where appropriate"). Same query string as the page, same
 * audit-on-bulk-read discipline as /admin/customers/export — this file
 * carries every restaurant's revenue and rating alongside each other, which
 * is exactly the kind of cross-vendor comparison §26 says must stay inside
 * Super Admin's hands.
 */

const SORTS = new Set<RestaurantComparisonSort>(["gmv", "orders", "aov", "rating", "tickets", "collection_rate"]);

const COLUMNS: readonly CsvColumn<RestaurantComparisonRow>[] = [
  { header: "Restaurant ID", value: (r) => r.restaurantId },
  { header: "Name", value: (r) => r.name },
  { header: "Status", value: (r) => r.status },
  { header: "GMV (INR)", value: (r) => csvPaise(r.gmvPaise) },
  { header: "Orders", value: (r) => r.orderCount },
  { header: "Average order (INR)", value: (r) => csvPaise(r.aovPaise) },
  { header: "Collected", value: (r) => r.collectedCount },
  { header: "Cancelled", value: (r) => r.cancelledCount },
  { header: "No-shows", value: (r) => r.noShowCount },
  { header: "Collection rate %", value: (r) => r.collectionRatePercent },
  { header: "Average rating", value: (r) => r.avgRating ?? "" },
  { header: "Ratings count", value: (r) => r.ratingCount },
  { header: "Open tickets now", value: (r) => r.openTicketCount },
];

export async function GET(request: Request) {
  const admin = await requireSuperAdmin();
  const sp = new URL(request.url).searchParams;

  const rawDays = Number.parseInt(sp.get("days") ?? "", 10);
  const days: AnalyticsRangeDays = (ANALYTICS_RANGE_DAYS as readonly number[]).includes(rawDays)
    ? (rawDays as AnalyticsRangeDays)
    : 30;
  const rawSort = sp.get("sort") as RestaurantComparisonSort | null;
  const sort = rawSort && SORTS.has(rawSort) ? rawSort : "gmv";

  const data = await getRestaurantComparison(days, sort);

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: "analytics.restaurants_exported",
    targetTable: "restaurants",
    after: { days, sort, rowsExported: data.rows.length, cappedByScan: data.truncated },
  });

  return new Response(toCsvDownload(data.rows, COLUMNS), {
    headers: csvResponseHeaders(csvFilename("restaurant-comparison")),
  });
}
