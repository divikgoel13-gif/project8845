import { requireSuperAdmin } from "@/lib/auth/guards";
import {
  listCustomers,
  type CustomerActivity,
  type CustomerListFilters,
  type CustomerListRow,
  type CustomerSegment,
  type CustomerSort,
} from "@/lib/admin/customers";
import {
  toCsvDownload,
  csvResponseHeaders,
  csvFilename,
  csvPaise,
  csvTimestamp,
  type CsvColumn,
} from "@/lib/admin/csv";
import { recordAuditEvent } from "@/lib/audit/log";

/**
 * Customer directory export (SRS §7.1 "Export capabilities", §14).
 *
 * Takes the SAME query string as /admin/customers, so exporting is a link off the
 * page rather than a second filter UI that can quietly disagree with the table.
 *
 * This is the most privacy-sensitive export in the console: it carries names,
 * emails, phone numbers, spend and behavioural flags for a whole segment of real
 * students out of the platform in one file. It is therefore audit logged with the
 * filter set and the row count, per §15/§18 — a bulk read of personal data is an
 * administrative act even though nothing is written.
 *
 * The derived flags are exported as a single joined column rather than one column
 * per flag. A wide sparse matrix is harder to read in a spreadsheet, and the flag
 * vocabulary is allowed to grow without invalidating a saved template.
 */

const MAX_EXPORT_ROWS = 10_000;

const SEGMENTS = new Set<CustomerSegment>([
  "all",
  "active",
  "inactive",
  "new",
  "repeat",
  "high_value",
  "open_grievance",
  "cancellations",
  "no_shows",
  "payment_issue",
  "manually_flagged",
]);

const ACTIVITIES = new Set<CustomerActivity>(["any", "7d", "30d", "90d", "dormant", "never"]);

const SORTS = new Set<CustomerSort>(["joined", "spend", "orders", "last_order", "name", "issues"]);

function parseDate(raw: string | null): string | undefined {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

const COLUMNS: readonly CsvColumn<CustomerListRow>[] = [
  { header: "Customer ID", value: (c) => c.id },
  { header: "Name", value: (c) => c.name },
  { header: "Email", value: (c) => c.email },
  { header: "Phone", value: (c) => c.phone },
  { header: "Course", value: (c) => c.course },
  { header: "Account status", value: (c) => c.accountStatus },
  { header: "Joined at (UTC)", value: (c) => csvTimestamp(c.joinedAt) },
  { header: "Orders placed", value: (c) => c.orderCount },
  { header: "Orders completed", value: (c) => c.realizedCount },
  { header: "Cancelled", value: (c) => c.cancelledCount },
  { header: "No-shows", value: (c) => c.noShowCount },
  // Sum of each order's own `subtotal_paise` snapshot (SRS §11.5), never
  // recomputed from today's menu prices.
  { header: "Lifetime spend (INR)", value: (c) => csvPaise(c.lifetimeSpendPaise) },
  { header: "Average order (INR)", value: (c) => csvPaise(c.averageOrderPaise) },
  { header: "Last order at (UTC)", value: (c) => csvTimestamp(c.lastOrderAt) },
  { header: "Average rating", value: (c) => c.averageStars },
  { header: "Ratings given", value: (c) => c.ratingCount },
  { header: "Open support issues", value: (c) => c.openIssueCount },
  { header: "Derived flags", value: (c) => c.derivedFlags.map((f) => f.label).join("; ") },
  { header: "Manual flags", value: (c) => c.manualFlags.join("; ") },
];

export async function GET(request: Request) {
  const admin = await requireSuperAdmin();
  const sp = new URL(request.url).searchParams;

  const rawSegment = sp.get("segment") as CustomerSegment | null;
  const rawActivity = sp.get("activity") as CustomerActivity | null;
  const rawSort = sp.get("sort") as CustomerSort | null;

  const filters: CustomerListFilters = {
    search: sp.get("q")?.trim() || undefined,
    segment: rawSegment && SEGMENTS.has(rawSegment) ? rawSegment : undefined,
    activity: rawActivity && ACTIVITIES.has(rawActivity) ? rawActivity : undefined,
    joinedFrom: parseDate(sp.get("from")),
    joinedTo: parseDate(sp.get("to")),
    sort: rawSort && SORTS.has(rawSort) ? rawSort : undefined,
    page: 1,
    pageSize: MAX_EXPORT_ROWS,
  };

  const { rows, total, truncated } = await listCustomers(filters);

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: "customers.exported",
    targetTable: "profiles",
    after: {
      filters,
      rowsExported: rows.length,
      matchedTotal: total,
      // Two different truncations, both worth recording: the export cap, and the
      // reader's own scan cap, which means the matched total was itself a floor.
      cappedByExport: total > rows.length,
      cappedByScan: truncated,
    },
  });

  return new Response(toCsvDownload(rows, COLUMNS), { headers: csvResponseHeaders(csvFilename("customers")) });
}
