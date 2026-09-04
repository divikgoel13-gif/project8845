import {
  getProductPerformance,
  type ProductPerformanceSort,
  type ProductPerformanceRow,
  ANALYTICS_RANGE_DAYS,
  type AnalyticsRangeDays,
} from "@/lib/admin/analytics";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { toCsvDownload, csvResponseHeaders, csvFilename, csvPaise, type CsvColumn } from "@/lib/admin/csv";
import { recordAuditEvent } from "@/lib/audit/log";

/**
 * Product performance export (SRS Phase 9). Same query string as the page.
 * Unlike the on-page table this is NOT capped to the top 50 — an operator
 * exporting almost always wants the full list to pivot elsewhere, and the
 * underlying aggregate is already bounded by lib/admin/analytics.ts's own
 * scan cap, so a second cap here would only make the export lie about a
 * "top 50" that a wider CSV silently contradicts.
 */

const COLUMNS: readonly CsvColumn<ProductPerformanceRow>[] = [
  { header: "Restaurant", value: (r) => r.restaurantName },
  { header: "Product", value: (r) => r.name },
  { header: "Quantity sold", value: (r) => r.quantitySold },
  { header: "Revenue (INR)", value: (r) => csvPaise(r.revenuePaise) },
];

export async function GET(request: Request) {
  const admin = await requireSuperAdmin();
  const sp = new URL(request.url).searchParams;

  const rawDays = Number.parseInt(sp.get("days") ?? "", 10);
  const days: AnalyticsRangeDays = (ANALYTICS_RANGE_DAYS as readonly number[]).includes(rawDays)
    ? (rawDays as AnalyticsRangeDays)
    : 30;
  const sort: ProductPerformanceSort = sp.get("sort") === "revenue" ? "revenue" : "quantity";
  const restaurantId = sp.get("restaurant")?.trim() || undefined;

  const data = await getProductPerformance(days, sort, restaurantId);

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: "analytics.products_exported",
    targetTable: "order_items",
    after: {
      days,
      sort,
      restaurantId: restaurantId ?? null,
      rowsExported: data.rows.length,
      cappedByScan: data.truncated,
    },
  });

  return new Response(toCsvDownload(data.rows, COLUMNS), {
    headers: csvResponseHeaders(csvFilename("product-performance")),
  });
}
