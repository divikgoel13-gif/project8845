import { requireSuperAdmin } from "@/lib/auth/guards";
import {
  listGrievances,
  type GrievanceCategory,
  type GrievanceFilters,
  type GrievancePriority,
  type GrievanceQueueRow,
  type GrievanceQueueView,
  type GrievanceRequesterRole,
  type GrievanceSort,
  type GrievanceStatus,
} from "@/lib/admin/grievances";
import { formatSlaRemaining } from "@/lib/grievance/sla";
import {
  toCsvDownload,
  csvResponseHeaders,
  csvFilename,
  csvTimestamp,
  csvBool,
  type CsvColumn,
} from "@/lib/admin/csv";
import { recordAuditEvent } from "@/lib/audit/log";

/**
 * Grievance queue export (SRS §13 "Search and filter", §14, §18).
 *
 * Takes the SAME query string as /admin/grievances so "export what I am looking
 * at" is a link off the page rather than a second filter UI that can drift out
 * of agreement with the table.
 *
 * Deliberately exports SLA state as three plain columns (breached, first
 * response met, resolution met) rather than one composite label. Support
 * performance reporting in Phase 9 needs to count breaches, and a spreadsheet
 * cannot filter on prose.
 *
 * Message bodies are NOT exported. A ticket thread can contain internal notes,
 * and a CSV is the easiest thing in this console to forward to somebody who
 * should not have them; the export therefore carries metadata only and the
 * thread stays behind the RLS-scoped page. This is also why the export itself is
 * audit logged with the filter set and row count — a bulk read of complaint
 * records about named students is an administrative act even though nothing is
 * written.
 */

const MAX_EXPORT_ROWS = 10_000;

const VIEWS = new Set<GrievanceQueueView>([
  "all",
  "unassigned",
  "mine",
  "breaching",
  "waiting_on_us",
  "waiting_on_them",
  "escalated",
  "unresolved",
  "resolved",
]);

const ROLES = new Set<GrievanceRequesterRole>(["customer", "vendor"]);

const STATUSES = new Set<GrievanceStatus>([
  "open",
  "in_review",
  "waiting_customer",
  "waiting_vendor",
  "escalated",
  "resolved",
  "closed",
]);

const CATEGORIES = new Set<GrievanceCategory>([
  "payment",
  "refund",
  "wrong_item",
  "missing_item",
  "pickup",
  "qr",
  "vendor_issue",
  "staff_issue",
  "product_issue",
  "account",
  "technical",
  "other",
]);

const PRIORITIES = new Set<GrievancePriority>(["low", "normal", "high", "urgent"]);

const SORTS = new Set<GrievanceSort>(["updated", "created", "sla", "priority", "ticket"]);

function parseDate(raw: string | null): string | undefined {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

function parseUuid(raw: string | null): string | undefined {
  return raw && /^[0-9a-fA-F-]{36}$/.test(raw) ? raw : undefined;
}

const COLUMNS: readonly CsvColumn<GrievanceQueueRow>[] = [
  { header: "Ticket no", value: (t) => t.ticketNo },
  { header: "Ticket ID", value: (t) => t.id },
  { header: "Raised by", value: (t) => t.requesterRole },
  { header: "Requester", value: (t) => t.requesterName },
  { header: "Requester contact", value: (t) => t.requesterContact },
  { header: "Category", value: (t) => t.category },
  { header: "Priority", value: (t) => t.priority },
  { header: "Status", value: (t) => t.status },
  { header: "Restaurant", value: (t) => t.restaurantName },
  { header: "Order ID", value: (t) => t.orderId },
  { header: "Assigned to", value: (t) => t.assigneeName },
  { header: "Raised at (UTC)", value: (t) => csvTimestamp(t.createdAt) },
  { header: "Last updated (UTC)", value: (t) => csvTimestamp(t.updatedAt) },
  { header: "First response due (UTC)", value: (t) => csvTimestamp(t.sla.firstResponseDueAt) },
  { header: "First response met", value: (t) => csvBool(t.sla.firstResponseMet) },
  { header: "Resolution due (UTC)", value: (t) => csvTimestamp(t.sla.resolutionDueAt) },
  { header: "Resolution met", value: (t) => csvBool(t.sla.resolutionMet) },
  { header: "SLA breached", value: (t) => csvBool(t.sla.breached) },
  { header: "Clock", value: (t) => formatSlaRemaining(t.sla.minutesRemaining) ?? "" },
  { header: "Escalated at (UTC)", value: (t) => csvTimestamp(t.escalatedAt) },
  { header: "Times reopened", value: (t) => t.reopenedCount },
  { header: "Requester rating", value: (t) => t.csatScore },
];

export async function GET(request: Request) {
  const admin = await requireSuperAdmin();
  const sp = new URL(request.url).searchParams;

  const rawView = sp.get("view") as GrievanceQueueView | null;
  const rawRole = sp.get("role") as GrievanceRequesterRole | null;
  const rawStatus = sp.get("status") as GrievanceStatus | null;
  const rawCategory = sp.get("category") as GrievanceCategory | null;
  const rawPriority = sp.get("priority") as GrievancePriority | null;
  const rawSort = sp.get("sort") as GrievanceSort | null;

  const filters: GrievanceFilters = {
    search: sp.get("q")?.trim() || undefined,
    view: rawView && VIEWS.has(rawView) ? rawView : "all",
    requesterRole: rawRole && ROLES.has(rawRole) ? rawRole : undefined,
    status: rawStatus && STATUSES.has(rawStatus) ? rawStatus : undefined,
    category: rawCategory && CATEGORIES.has(rawCategory) ? rawCategory : undefined,
    priority: rawPriority && PRIORITIES.has(rawPriority) ? rawPriority : undefined,
    assigneeId: parseUuid(sp.get("assignee")),
    restaurantId: parseUuid(sp.get("restaurant")),
    from: parseDate(sp.get("from")),
    to: parseDate(sp.get("to")),
    sort: rawSort && SORTS.has(rawSort) ? rawSort : undefined,
    page: 1,
    pageSize: MAX_EXPORT_ROWS,
    // Needed for the "mine" view, which is otherwise meaningless in a route
    // handler that has no page context.
    viewerId: admin.id,
  };

  const { rows, total, truncated } = await listGrievances(filters);

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: "grievances.exported",
    targetTable: "grievance_tickets",
    after: {
      filters,
      rowsExported: rows.length,
      matchedTotal: total,
      cappedByExport: total > rows.length,
      cappedByScan: truncated,
    },
  });

  return new Response(toCsvDownload(rows, COLUMNS), {
    headers: csvResponseHeaders(csvFilename("grievances")),
  });
}
