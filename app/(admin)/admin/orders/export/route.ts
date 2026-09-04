import { requireSuperAdmin } from "@/lib/auth/guards";
import { listGlobalOrders, type OrderListFilters, type OrderListRow } from "@/lib/admin/orders";
import {
  toCsvDownload,
  csvResponseHeaders,
  csvFilename,
  csvPaise,
  csvTimestamp,
  type CsvColumn,
} from "@/lib/admin/csv";
import { orderStatusLabel, ORDER_STATUS_FILTERS, type OrderStatus } from "@/lib/orders/status-groups";
import { recordAuditEvent } from "@/lib/audit/log";

/**
 * Filtered order export (SRS §14 "Export capabilities where appropriate").
 *
 * The route takes the SAME query string as /admin/orders, so "export what I am
 * looking at" is a link rather than a second filter UI that can disagree with
 * the table.
 *
 * Capped at 10,000 rows deliberately: this runs inside a request, and an
 * unbounded export of the whole order history would time out and give the
 * operator a truncated file with no warning. The cap is reported in the audit
 * entry so a short file is explicable after the fact.
 *
 * The export is audit logged. It is a read, but it is a BULK read of customer
 * names, emails and order values leaving the platform, which §15/§18 treat as an
 * administrative event worth attributing.
 */

const MAX_EXPORT_ROWS = 10_000;

const SYNTHETIC = new Set(["all", "realized", "in_flight"]);

function parseStatus(raw: string | null): OrderListFilters["status"] {
  if (!raw) return undefined;
  if (SYNTHETIC.has(raw)) return raw as OrderListFilters["status"];
  return (ORDER_STATUS_FILTERS as readonly string[]).includes(raw) ? (raw as OrderStatus) : undefined;
}

function parseDate(raw: string | null): string | undefined {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

const COLUMNS: readonly CsvColumn<OrderListRow>[] = [
  { header: "Order ID", value: (o) => o.id },
  { header: "Placed at (UTC)", value: (o) => csvTimestamp(o.createdAt) },
  { header: "Status", value: (o) => orderStatusLabel(o.status) },
  { header: "Restaurant", value: (o) => o.restaurantName },
  { header: "Restaurant ID", value: (o) => o.restaurantId },
  { header: "Customer", value: (o) => o.customerName },
  { header: "Customer email", value: (o) => o.customerEmail },
  { header: "Customer ID", value: (o) => o.customerId },
  { header: "Items", value: (o) => o.itemCount },
  { header: "Subtotal (INR)", value: (o) => csvPaise(o.subtotalPaise) },
  // Snapshot columns, exported as stored (SRS §11.5) — an export recomputed
  // from today's commission rate would not reconcile with the ledger.
  { header: "Commission (INR)", value: (o) => csvPaise(o.commissionAmountPaise) },
  { header: "Vendor payable (INR)", value: (o) => csvPaise(o.vendorPayablePaise) },
  { header: "Pickup time (UTC)", value: (o) => csvTimestamp(o.pickupTime) },
  { header: "Collected at (UTC)", value: (o) => csvTimestamp(o.collectedAt) },
  { header: "Checkout group", value: (o) => o.groupId },
];

export async function GET(request: Request) {
  const admin = await requireSuperAdmin();
  const sp = new URL(request.url).searchParams;

  const filters: OrderListFilters = {
    status: parseStatus(sp.get("status")),
    restaurantId: sp.get("restaurantId") || undefined,
    customerId: sp.get("customerId") || undefined,
    fromDate: parseDate(sp.get("from")),
    toDate: parseDate(sp.get("to")),
    search: sp.get("q")?.trim() || undefined,
    page: 1,
    pageSize: MAX_EXPORT_ROWS,
  };

  const { rows, total } = await listGlobalOrders(filters);

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: "orders.exported",
    targetTable: "orders",
    restaurantId: filters.restaurantId ?? undefined,
    after: { filters, rowsExported: rows.length, matchedTotal: total, truncated: total > rows.length },
  });

  return new Response(toCsvDownload(rows, COLUMNS), { headers: csvResponseHeaders(csvFilename("orders")) });
}
