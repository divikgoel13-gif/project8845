import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { paiseToRupeesDisplay } from "@/lib/money";
import { ADMIN_PAGE_SIZE } from "@/components/ui/pagination";
import { REALIZED_SALE_STATUSES, type OrderStatus } from "@/lib/orders/status-groups";

/**
 * Customer 360 CRM readers (SRS §7).
 *
 * §7 opens by saying what this is NOT: "It is not a simple user table. It is a
 * high-level CRM where an Admin can understand the complete history and current
 * state of an individual customer." Two consequences shape this whole module.
 *
 * FIRST: every column §7.1 asks for in the directory — orders, lifetime spend,
 * last order, average rating, open issues — is an aggregate across a different
 * table, and every filter §7.1 asks for (repeat, high-value, cancellations,
 * no-shows, open grievance) is a predicate ON one of those aggregates. A
 * predicate on an aggregate cannot be pushed into a PostgREST row filter, so
 * paginating `profiles` first and aggregating the page afterwards would produce a
 * "high value customers" list that is really "high value customers who happen to
 * be on page 1". The aggregates are therefore built for the whole customer body
 * in one pass, then filtered, then sorted, then paginated — in that order.
 *
 * The pass is capped (see SCAN_CAP). This is the same tradeoff `filteredTotals`
 * in lib/admin/orders.ts and the vendor analytics readers already make, and it is
 * honest at campus scale: a few thousand customers and tens of thousands of
 * orders. `truncated` is returned so a page can say so rather than quietly
 * under-reporting.
 *
 * SECOND: the §7.3 flags are DERIVED, not stored. The SRS is explicit — "Flags
 * must be data-driven/operational, not arbitrary character judgments" — so the
 * six standard flags are computed from the aggregates every read, and cannot
 * drift from the orders that justify them. `customer_flags` rows exist for the
 * separate case §7.3 also allows ("Any admin-created flag must be auditable"):
 * an operator's manual annotation, which carries a reason, an author and a clear
 * history. The two are never merged in the return type, because one is evidence
 * and the other is an opinion.
 *
 * Privacy: this module is the internal CRM. SRS line "Customers do not access
 * the internal CRM" is enforced two layers below — `customer_admin_notes` and
 * `customer_flags` are super-admin-only in RLS (0017), with no self-select
 * policy — but nothing here should ever be imported by a customer-facing route,
 * which is what `import "server-only"` plus the super-admin guard on every page
 * is for.
 */

/**
 * Row ceiling for the aggregate pass. Chosen so the pass is bounded by something
 * stated rather than by whatever PostgREST's default happens to be, and set well
 * above any plausible campus volume. When it bites, `truncated` goes true.
 */
const SCAN_CAP = 50_000;

/**
 * §7.3 thresholds, in one place because they are the definition of the flags and
 * an operator will eventually ask "why is this person High Value". Every one is a
 * count or a sum over the customer's own history, which is what "data-driven /
 * operational, not arbitrary character judgments" requires.
 *
 * Deliberately constants and not `admin_settings` rows: these feed a label on a
 * list, not money or access. A settings row would need a UI, an audit entry and a
 * migration to buy an operator the ability to move a badge threshold, and would
 * make two exports of the same directory a week apart disagree for no recorded
 * reason.
 */
export const CUSTOMER_FLAG_RULES = {
  /** Lifetime realized spend at or above ₹5,000. */
  highValueSpendPaise: 500_000,
  /** Realized orders at or above this count. */
  frequentOrderCount: 10,
  /** No-shows at or above this count — two is a pattern, one is a bad day. */
  repeatedNoShowCount: 2,
  /** Cancellations at or above this count AND above this share of their orders. */
  frequentCancellationCount: 3,
  frequentCancellationShare: 0.2,
} as const;

export type DerivedFlagKey =
  | "high_value"
  | "frequent"
  | "open_issue"
  | "payment_issue"
  | "repeated_no_shows"
  | "frequent_cancellations";

export type DerivedFlag = {
  key: DerivedFlagKey;
  label: string;
  /** The evidence, phrased so it can be read aloud to the customer. */
  detail: string;
  tone: "info" | "success" | "warning" | "danger";
};

/* ── The aggregate pass ──────────────────────────────────────────────────── */

/**
 * Everything the directory and the §7.2 Overview need about one customer that is
 * not on `profiles`. Accumulated, never queried per-customer: 25 customers on a
 * page would otherwise be 100 round trips.
 */
export type CustomerAggregate = {
  /** Excludes `cart` throughout — an abandoned basket is not an order. */
  orderCount: number;
  realizedCount: number;
  /** Sum of `subtotal_paise` over realized orders, read from the snapshot. */
  lifetimeSpendPaise: number;
  lastOrderAt: string | null;
  cancelledCount: number;
  noShowCount: number;
  refundedCount: number;
  ratingCount: number;
  starSum: number;
  openIssueCount: number;
  /** `payments.status = 'failed'`, or an order left in `payment_pending`. */
  paymentProblemCount: number;
};

function emptyAggregate(): CustomerAggregate {
  return {
    orderCount: 0,
    realizedCount: 0,
    lifetimeSpendPaise: 0,
    lastOrderAt: null,
    cancelledCount: 0,
    noShowCount: 0,
    refundedCount: 0,
    ratingCount: 0,
    starSum: 0,
    openIssueCount: 0,
    paymentProblemCount: 0,
  };
}

const REALIZED = new Set<string>(REALIZED_SALE_STATUSES);

/** §13 statuses that still need somebody to do something. */
const OPEN_GRIEVANCE_STATUSES = ["open", "in_review", "waiting_customer", "waiting_vendor", "escalated"] as const;

/**
 * Four parallel scans, folded into one map keyed by customer id.
 *
 * Orders, ratings, tickets and payments are read separately rather than as nested
 * selects under `profiles`, because a nested select applies its LIMIT to the
 * parent rows: `profiles(*, orders(*))` capped at 25 profiles silently caps the
 * order history too, and every total computed from it would be wrong in a way
 * nobody notices. Four flat scans have no such trap.
 *
 * `payments.customer_id` is used directly here. Elsewhere payments reach orders
 * through `group_id` (there is no `payments.order_id`), but for "has this person
 * had payment trouble" the customer column is exactly the right grain.
 */
async function buildAggregates(): Promise<{ map: Map<string, CustomerAggregate>; truncated: boolean }> {
  const supabase = createServerSupabaseClient();

  const [orders, ratings, tickets, payments] = await Promise.all([
    supabase
      .from("orders")
      .select("customer_id, status, subtotal_paise, created_at")
      .not("status", "eq", "cart")
      .order("created_at", { ascending: false })
      .limit(SCAN_CAP),
    supabase.from("ratings").select("customer_id, stars").limit(SCAN_CAP),
    supabase
      .from("grievance_tickets")
      .select("requester_id, status")
      .eq("requester_role", "customer")
      .in("status", [...OPEN_GRIEVANCE_STATUSES])
      .limit(SCAN_CAP),
    supabase.from("payments").select("customer_id, status").eq("status", "failed").limit(SCAN_CAP),
  ]);

  const map = new Map<string, CustomerAggregate>();
  const at = (id: string) => {
    const existing = map.get(id);
    if (existing) return existing;
    const fresh = emptyAggregate();
    map.set(id, fresh);
    return fresh;
  };

  const orderRows = (orders.data ?? []) as {
    customer_id: string;
    status: OrderStatus;
    subtotal_paise: number;
    created_at: string;
  }[];

  for (const o of orderRows) {
    const agg = at(o.customer_id);
    agg.orderCount += 1;
    // Ordered newest-first, so the first row seen for a customer is their last
    // order. Comparing dates on every row would be the same answer, slower.
    if (agg.lastOrderAt === null) agg.lastOrderAt = o.created_at;
    if (REALIZED.has(o.status)) {
      agg.realizedCount += 1;
      agg.lifetimeSpendPaise += o.subtotal_paise;
    }
    if (o.status === "cancelled") agg.cancelledCount += 1;
    if (o.status === "no_show") agg.noShowCount += 1;
    if (o.status === "refunded" || o.status === "refund_pending") agg.refundedCount += 1;
    // An order still sitting in `payment_pending` is a checkout that took the
    // customer's intent and gave them nothing — the §7.3 "Payment Issue" case
    // that has no `payments` row to point at.
    if (o.status === "payment_pending") agg.paymentProblemCount += 1;
  }

  for (const r of (ratings.data ?? []) as { customer_id: string; stars: number }[]) {
    const agg = at(r.customer_id);
    agg.ratingCount += 1;
    agg.starSum += r.stars;
  }

  for (const t of (tickets.data ?? []) as { requester_id: string }[]) {
    at(t.requester_id).openIssueCount += 1;
  }

  for (const p of (payments.data ?? []) as { customer_id: string }[]) {
    at(p.customer_id).paymentProblemCount += 1;
  }

  return { map, truncated: orderRows.length >= SCAN_CAP };
}

/**
 * The six §7.3 flags, each carrying the number that produced it.
 *
 * The detail string matters as much as the flag: "High value" on its own is an
 * assertion, "₹6,240 lifetime across 14 orders" is a fact an operator can repeat
 * to the customer, and it is the difference between an operational flag and the
 * "arbitrary character judgment" §7.3 forbids.
 *
 * `frequent_cancellations` requires BOTH a count and a share. Three cancellations
 * out of four orders is a pattern; three out of ninety is a normal customer who
 * has been here a long time, and flagging them would train operators to ignore
 * the flag.
 */
export function deriveCustomerFlags(agg: CustomerAggregate): DerivedFlag[] {
  const flags: DerivedFlag[] = [];
  const rupees = (paise: number) => paiseToRupeesDisplay(paise);

  if (agg.lifetimeSpendPaise >= CUSTOMER_FLAG_RULES.highValueSpendPaise) {
    flags.push({
      key: "high_value",
      label: "High value",
      detail: `${rupees(agg.lifetimeSpendPaise)} lifetime across ${agg.realizedCount} completed orders`,
      tone: "success",
    });
  }

  if (agg.realizedCount >= CUSTOMER_FLAG_RULES.frequentOrderCount) {
    flags.push({
      key: "frequent",
      label: "Frequent customer",
      detail: `${agg.realizedCount} completed orders`,
      tone: "info",
    });
  }

  if (agg.openIssueCount > 0) {
    flags.push({
      key: "open_issue",
      label: "Open support issue",
      detail: `${agg.openIssueCount} ticket${agg.openIssueCount === 1 ? "" : "s"} still needing a response`,
      tone: "warning",
    });
  }

  if (agg.paymentProblemCount > 0) {
    flags.push({
      key: "payment_issue",
      label: "Payment issue",
      detail: `${agg.paymentProblemCount} failed payment${agg.paymentProblemCount === 1 ? "" : "s"} or stalled checkout${agg.paymentProblemCount === 1 ? "" : "s"}`,
      tone: "danger",
    });
  }

  if (agg.noShowCount >= CUSTOMER_FLAG_RULES.repeatedNoShowCount) {
    flags.push({
      key: "repeated_no_shows",
      label: "Repeated no-shows",
      detail: `${agg.noShowCount} orders paid for and never collected`,
      tone: "danger",
    });
  }

  const share = agg.orderCount > 0 ? agg.cancelledCount / agg.orderCount : 0;
  if (
    agg.cancelledCount >= CUSTOMER_FLAG_RULES.frequentCancellationCount &&
    share > CUSTOMER_FLAG_RULES.frequentCancellationShare
  ) {
    flags.push({
      key: "frequent_cancellations",
      label: "Frequent cancellations",
      detail: `${agg.cancelledCount} of ${agg.orderCount} orders cancelled (${Math.round(share * 100)}%)`,
      tone: "warning",
    });
  }

  return flags;
}

/* ── §7.1 Customer directory ─────────────────────────────────────────────── */

/**
 * The §7.1 filter vocabulary, transcribed rather than reinterpreted: "Active/
 * inactive, new, repeat, high-value, open grievance, cancellations, no-shows,
 * joined date, last activity."
 *
 * "Active/inactive" is read as the ACCOUNT state (`profiles.status`) and not as
 * recent activity, because §7.1 lists "last activity" separately as its own
 * filter. Conflating them would leave no way to find a disabled account that used
 * to order daily — which is exactly the account someone asks about.
 */
export type CustomerSegment =
  | "all"
  | "active"
  | "inactive"
  | "new"
  | "repeat"
  | "high_value"
  | "open_grievance"
  | "cancellations"
  | "no_shows"
  | "payment_issue"
  | "manually_flagged";

/** Windows for the "last activity" filter, measured from the last non-cart order. */
export type CustomerActivity = "any" | "7d" | "30d" | "90d" | "dormant" | "never";

export type CustomerSort = "joined" | "spend" | "orders" | "last_order" | "name" | "issues";

/** A customer counts as "new" for their first month. */
const NEW_CUSTOMER_DAYS = 30;
/** "Dormant" means no order in this long, but they have ordered at some point. */
const DORMANT_DAYS = 90;

export type CustomerListFilters = {
  /** §7.1: "Name, phone, email, order ID, ticket ID." */
  search?: string;
  segment?: CustomerSegment;
  activity?: CustomerActivity;
  /** `YYYY-MM-DD`, inclusive. */
  joinedFrom?: string;
  joinedTo?: string;
  sort?: CustomerSort;
  page?: number;
  pageSize?: number;
};

/** The §7.1 columns: "Customer, orders, lifetime spend, last order, average rating, open issues, status." */
export type CustomerListRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  course: string | null;
  accountStatus: "active" | "disabled";
  joinedAt: string;

  orderCount: number;
  realizedCount: number;
  cancelledCount: number;
  noShowCount: number;
  lifetimeSpendPaise: number;
  /** Average order value over REALIZED orders only — a cancelled order has no value. */
  averageOrderPaise: number | null;
  lastOrderAt: string | null;
  averageStars: number | null;
  ratingCount: number;
  openIssueCount: number;

  /** Computed from this customer's own history every read (§7.3). */
  derivedFlags: DerivedFlag[];
  /** Labels of uncleared `customer_flags` rows — an operator's annotation. */
  manualFlags: string[];
};

export type CustomerListResult = {
  rows: CustomerListRow[];
  total: number;
  page: number;
  pageSize: number;
  /** True when the aggregate pass hit SCAN_CAP and the numbers are a floor. */
  truncated: boolean;
  /** Across the whole FILTERED set, not the page. */
  totals: {
    customers: number;
    disabledAccounts: number;
    lifetimeSpendPaise: number;
    withOpenIssues: number;
  };
};

/**
 * §7.1 search resolves to a SET OF CUSTOMER IDS rather than to a WHERE clause,
 * because the five things it must accept do not live on one table: name, phone
 * and email are on `profiles`, an order id is on `orders`, and a ticket id is on
 * `grievance_tickets`. Every branch that can contribute is run and the results are
 * unioned, so typing a number finds both the student whose phone contains it and
 * the ticket numbered that.
 *
 * Returning `[]` means "matched nothing" and the caller must render an empty page.
 * It must not fall back to showing everything: a search that silently ignores
 * itself is how an operator concludes a customer does not exist.
 */
async function resolveSearchToCustomerIds(term: string): Promise<string[]> {
  const supabase = createServerSupabaseClient();
  const ids = new Set<string>();

  const looksLikeUuidPrefix = /^[0-9a-f]{4,}[0-9a-f-]*$/i.test(term);
  const looksLikeTicketNo = /^\d{1,12}$/.test(term);

  const [profiles, orders, ticketsById, ticketsByNo] = await Promise.all([
    supabase
      .from("profiles")
      .select("id")
      .eq("role", "customer")
      .or(`name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`)
      .limit(500),
    looksLikeUuidPrefix
      ? supabase.from("orders").select("customer_id").ilike("id", `${term}%`).limit(200)
      : Promise.resolve({ data: [] }),
    looksLikeUuidPrefix
      ? supabase.from("grievance_tickets").select("requester_id").ilike("id", `${term}%`).limit(200)
      : Promise.resolve({ data: [] }),
    looksLikeTicketNo
      ? supabase.from("grievance_tickets").select("requester_id").eq("ticket_no", Number(term)).limit(50)
      : Promise.resolve({ data: [] }),
  ]);

  for (const p of (profiles.data ?? []) as { id: string }[]) ids.add(p.id);
  for (const o of (orders.data ?? []) as { customer_id: string }[]) ids.add(o.customer_id);
  for (const t of (ticketsById.data ?? []) as { requester_id: string }[]) ids.add(t.requester_id);
  for (const t of (ticketsByNo.data ?? []) as { requester_id: string }[]) ids.add(t.requester_id);

  return [...ids];
}

/**
 * Uncleared manual flags, keyed by customer. Cleared rows are excluded here but
 * never deleted — `customer_flags` keeps `cleared_at`, `cleared_by` and
 * `clear_reason` so "who flagged this person in March and why did it go away" stays
 * answerable (§7.3 "Any admin-created flag must be auditable", §P).
 */
async function loadActiveManualFlags(): Promise<Map<string, string[]>> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from("customer_flags")
    .select("customer_id, flag")
    .is("cleared_at", null)
    .limit(SCAN_CAP);

  const map = new Map<string, string[]>();
  for (const row of (data ?? []) as { customer_id: string; flag: string }[]) {
    const list = map.get(row.customer_id);
    if (list) list.push(row.flag);
    else map.set(row.customer_id, [row.flag]);
  }
  return map;
}

function daysAgo(days: number): number {
  return Date.now() - days * 86_400_000;
}

/** Segment predicates, one place so the list page and the CSV export cannot diverge. */
function matchesSegment(row: CustomerListRow, segment: CustomerSegment): boolean {
  switch (segment) {
    case "active":
      return row.accountStatus === "active";
    case "inactive":
      return row.accountStatus === "disabled";
    case "new":
      return new Date(row.joinedAt).getTime() >= daysAgo(NEW_CUSTOMER_DAYS);
    case "repeat":
      return row.realizedCount >= 2;
    case "high_value":
      return row.lifetimeSpendPaise >= CUSTOMER_FLAG_RULES.highValueSpendPaise;
    case "open_grievance":
      return row.openIssueCount > 0;
    case "cancellations":
      return row.cancelledCount > 0;
    case "no_shows":
      return row.noShowCount > 0;
    case "payment_issue":
      return row.derivedFlags.some((f) => f.key === "payment_issue");
    case "manually_flagged":
      return row.manualFlags.length > 0;
    case "all":
    default:
      return true;
  }
}

/**
 * "Last activity" is the last non-cart order, not the last login. `profiles` has
 * no `last_login_at` column and Supabase keeps sign-in timestamps in `auth.users`,
 * which this reader deliberately does not touch — see `getCustomer360`. For a
 * food-ordering platform an order is the more useful signal anyway: a login with
 * no order is not activity an operator can act on.
 */
function matchesActivity(row: CustomerListRow, window: CustomerActivity): boolean {
  if (window === "any") return true;
  if (window === "never") return row.lastOrderAt === null;
  if (row.lastOrderAt === null) return false;
  const last = new Date(row.lastOrderAt).getTime();
  if (window === "dormant") return last < daysAgo(DORMANT_DAYS);
  const days = window === "7d" ? 7 : window === "30d" ? 30 : 90;
  return last >= daysAgo(days);
}

function compareBy(sort: CustomerSort): (a: CustomerListRow, b: CustomerListRow) => number {
  switch (sort) {
    case "spend":
      return (a, b) => b.lifetimeSpendPaise - a.lifetimeSpendPaise;
    case "orders":
      return (a, b) => b.orderCount - a.orderCount;
    case "last_order":
      // Never-ordered customers sort last rather than first: an empty cell at the
      // top of a list sorted by recency reads as a data problem.
      return (a, b) =>
        (b.lastOrderAt ? new Date(b.lastOrderAt).getTime() : -1) -
        (a.lastOrderAt ? new Date(a.lastOrderAt).getTime() : -1);
    case "name":
      return (a, b) => (a.name ?? "￿").localeCompare(b.name ?? "￿");
    case "issues":
      return (a, b) => b.openIssueCount - a.openIssueCount || b.orderCount - a.orderCount;
    case "joined":
    default:
      return (a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime();
  }
}

/**
 * The directory. Order of operations is aggregate → filter → sort → paginate, and
 * that order is the whole reason this function is not four chained PostgREST
 * calls: "high value" and "repeat" are predicates on sums, and a sum cannot be
 * computed after the LIMIT that decides which rows to sum.
 *
 * Only `role = 'customer'` profiles are considered. A vendor admin who also orders
 * lunch is not a CRM record — SRS §7 scopes this area to customers, and the
 * covering index `idx_profiles_customers` bakes the same predicate in.
 */
export async function listCustomers(filters: CustomerListFilters = {}): Promise<CustomerListResult> {
  const supabase = createServerSupabaseClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? ADMIN_PAGE_SIZE;
  const empty: CustomerListResult = {
    rows: [],
    total: 0,
    page,
    pageSize,
    truncated: false,
    totals: { customers: 0, disabledAccounts: 0, lifetimeSpendPaise: 0, withOpenIssues: 0 },
  };

  const term = filters.search?.trim();
  let searchIds: string[] | null = null;
  if (term) {
    searchIds = await resolveSearchToCustomerIds(term);
    if (searchIds.length === 0) return empty;
  }

  let profileQuery = supabase
    .from("profiles")
    .select("id, name, email, phone, course, status, created_at")
    .eq("role", "customer")
    .order("created_at", { ascending: false })
    .limit(SCAN_CAP);

  if (searchIds) profileQuery = profileQuery.in("id", searchIds);
  // Joined-date bounds are applied in SQL because they are the one §7.1 filter
  // that is a plain column predicate, and narrowing here shrinks everything after.
  if (filters.joinedFrom) profileQuery = profileQuery.gte("created_at", `${filters.joinedFrom}T00:00:00Z`);
  if (filters.joinedTo) profileQuery = profileQuery.lte("created_at", `${filters.joinedTo}T23:59:59Z`);

  const [profiles, aggregates, manualFlags] = await Promise.all([
    profileQuery,
    buildAggregates(),
    loadActiveManualFlags(),
  ]);

  const profileRows = (profiles.data ?? []) as {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    course: string | null;
    status: string;
    created_at: string;
  }[];

  const all: CustomerListRow[] = profileRows.map((p) => {
    const agg = aggregates.map.get(p.id) ?? emptyAggregate();
    return {
      id: p.id,
      name: p.name,
      email: p.email,
      phone: p.phone,
      course: p.course,
      accountStatus: p.status === "disabled" ? "disabled" : "active",
      joinedAt: p.created_at,
      orderCount: agg.orderCount,
      realizedCount: agg.realizedCount,
      cancelledCount: agg.cancelledCount,
      noShowCount: agg.noShowCount,
      lifetimeSpendPaise: agg.lifetimeSpendPaise,
      averageOrderPaise:
        agg.realizedCount > 0 ? Math.round(agg.lifetimeSpendPaise / agg.realizedCount) : null,
      lastOrderAt: agg.lastOrderAt,
      averageStars: agg.ratingCount > 0 ? Math.round((agg.starSum / agg.ratingCount) * 100) / 100 : null,
      ratingCount: agg.ratingCount,
      openIssueCount: agg.openIssueCount,
      derivedFlags: deriveCustomerFlags(agg),
      manualFlags: manualFlags.get(p.id) ?? [],
    };
  });

  const segment = filters.segment ?? "all";
  const activity = filters.activity ?? "any";
  const filtered = all.filter((r) => matchesSegment(r, segment) && matchesActivity(r, activity));
  filtered.sort(compareBy(filters.sort ?? "joined"));

  const totals = {
    customers: filtered.length,
    disabledAccounts: filtered.filter((r) => r.accountStatus === "disabled").length,
    lifetimeSpendPaise: filtered.reduce((sum, r) => sum + r.lifetimeSpendPaise, 0),
    withOpenIssues: filtered.filter((r) => r.openIssueCount > 0).length,
  };

  const start = (page - 1) * pageSize;
  return {
    rows: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    pageSize,
    truncated: aggregates.truncated || profileRows.length >= SCAN_CAP,
    totals,
  };
}

/* ── §7.2 Customer 360 workspace ─────────────────────────────────────────── */

/**
 * §7.2 names ten sections. Eight are built here in full. Two are deliberately
 * built as INDEXES that link out, and it is worth being explicit about which and
 * why, because "we shipped a summary and called it the section" is the failure
 * mode of a 360 view.
 *
 *  - Orders: §7.2 asks for "full order details … items, price snapshot, pickup,
 *    payment, QR, scan, staff, state history and linked grievance". All of that
 *    already exists, assembled and audit-linked, at `/admin/orders/[id]` via
 *    `getOrderDetailForAdmin`. Re-implementing it inside the customer view would
 *    create a second definition of an order's money, and the two would disagree
 *    the first time either changed. So this section carries every order with the
 *    fields needed to recognise and choose one, and links to the real detail.
 *  - Grievances: same reasoning against `/admin/grievances/[id]`, which owns
 *    messages, attachments, assignment and the reopen trail.
 *
 * Everything else — overview, activity timeline, payments, ratings, profile,
 * account & security, restaurant affinity, admin notes — is complete here.
 */

export type ManualFlag = {
  id: string;
  flag: string;
  reason: string;
  createdAt: string;
  createdByName: string | null;
};

export type Customer360Order = {
  id: string;
  status: OrderStatus;
  createdAt: string;
  pickupTime: string | null;
  readyAt: string | null;
  collectedAt: string | null;
  cancelledAt: string | null;
  noShowAt: string | null;
  restaurantId: string;
  restaurantName: string;
  subtotalPaise: number;
  itemCount: number;
  /** Names only — enough to recognise the order without loading the whole snapshot. */
  itemSummary: string;
  groupId: string | null;
  /** A scan token exists once a QR has been issued (§7.2 "QR, scan"). */
  qrIssued: boolean;
};

export type Customer360Payment = {
  id: string;
  status: string;
  amountPaise: number;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  createdAt: string;
  groupId: string | null;
  /** Orders this payment covers. A multi-restaurant checkout is ONE payment. */
  orderIds: string[];
};

export type Customer360Refund = {
  id: string;
  orderId: string;
  amountPaise: number;
  status: string;
  razorpayRefundId: string | null;
  grievanceTicketId: string | null;
  createdAt: string;
};

export type Customer360Ticket = {
  id: string;
  ticketNo: number | null;
  category: string;
  status: string;
  priority: string;
  createdAt: string;
  resolvedAt: string | null;
  reopenedCount: number;
  restaurantName: string | null;
  orderId: string | null;
  assigneeName: string | null;
  messageCount: number;
  resolutionNote: string | null;
};

export type Customer360Rating = {
  id: string;
  orderId: string;
  stars: number;
  comment: string | null;
  createdAt: string;
  restaurantName: string;
};

/** §7.2 "Restaurant Affinity — orders, spend and last order by restaurant". */
export type AffinityRow = {
  restaurantId: string;
  restaurantName: string;
  orderCount: number;
  spendPaise: number;
  lastOrderAt: string | null;
};

export type AdminNote = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string | null;
  authorRole: string | null;
};

/**
 * One entry in the §7.2 activity timeline. Assembled in process from the rows
 * already loaded for the other sections rather than from an events table: there is
 * no single table that records "order placed, payment verified, QR issued, order
 * prepared/ready, QR scanned, collected, rating, grievance, refund", and inventing
 * one would mean either a trigger on eight tables or a backfill that guesses at
 * history. Deriving it means the timeline cannot disagree with the sections above
 * it, which is the property that matters when an operator is reading both.
 */
export type TimelineEvent = {
  /** Stable within a render; composed from the source row's id and the event kind. */
  key: string;
  at: string;
  kind:
    | "account"
    | "order"
    | "payment"
    | "refund"
    | "rating"
    | "grievance"
    | "flag"
    | "note"
    | "notification";
  label: string;
  detail: string | null;
  /** Where to go for the full record, when there is one. */
  href: string | null;
};

export type Customer360SecurityEvent = {
  id: string;
  action: string;
  actorName: string | null;
  actorRole: string | null;
  reason: string | null;
  createdAt: string;
};

export type Customer360 = {
  profile: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    course: string | null;
    accountStatus: "active" | "disabled";
    joinedAt: string;
    updatedAt: string;
  };

  overview: {
    orderCount: number;
    realizedCount: number;
    cancelledCount: number;
    noShowCount: number;
    refundedCount: number;
    lifetimeSpendPaise: number;
    averageOrderPaise: number | null;
    averageStars: number | null;
    ratingCount: number;
    openIssueCount: number;
    totalIssueCount: number;
    lastActivityAt: string | null;
  };

  derivedFlags: DerivedFlag[];
  manualFlags: ManualFlag[];
  /** Cleared flags, kept visible because clearing is a decision worth seeing (§P). */
  clearedFlags: (ManualFlag & { clearedAt: string; clearedByName: string | null; clearReason: string | null })[];

  orders: Customer360Order[];
  payments: Customer360Payment[];
  refunds: Customer360Refund[];
  grievances: Customer360Ticket[];
  ratings: Customer360Rating[];
  affinity: AffinityRow[];
  notes: AdminNote[];
  /** §7.2 Account & Security: what this schema can actually evidence. */
  securityEvents: Customer360SecurityEvent[];
  timeline: TimelineEvent[];
};

/**
 * Caps for the 360 view. Generous enough that a real campus customer's entire
 * history fits, bounded so one pathological account cannot hang the page.
 */
const DETAIL_CAP = 500;

/**
 * Returns null for an id that is not a CUSTOMER, not merely for one that does not
 * exist. §7 scopes this area to customers, and letting the CRM render a staff or
 * vendor-admin profile would turn a customer-support tool into a general people
 * viewer with admin notes attached to colleagues.
 */
export async function getCustomer360(customerId: string): Promise<Customer360 | null> {
  const supabase = createServerSupabaseClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, name, email, phone, course, status, created_at, updated_at")
    .eq("id", customerId)
    .maybeSingle();

  if (!profile || (profile as { role: string }).role !== "customer") return null;
  const p = profile as {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    course: string | null;
    status: string;
    created_at: string;
    updated_at: string;
  };

  const [orders, payments, refunds, tickets, ratings, notes, flags, audit] = await Promise.all([
    supabase
      .from("orders")
      .select(
        `id, status, created_at, pickup_time, ready_at, collected_at, cancelled_at, no_show_at,
         restaurant_id, subtotal_paise, group_id, scan_token,
         restaurants ( name ),
         order_items ( name_snapshot, quantity )`
      )
      .eq("customer_id", customerId)
      .not("status", "eq", "cart")
      .order("created_at", { ascending: false })
      .limit(DETAIL_CAP),
    supabase
      .from("payments")
      .select("id, status, amount_paise, razorpay_order_id, razorpay_payment_id, created_at, group_id")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(DETAIL_CAP),
    // refund_events has no customer column; the inner join on orders is what
    // scopes it, and `!inner` (not a plain embed) is what makes the filter a
    // restriction rather than a null-tolerant left join.
    supabase
      .from("refund_events")
      .select(
        "id, order_id, amount_paise, status, razorpay_refund_id, grievance_ticket_id, created_at, orders!inner ( customer_id )"
      )
      .eq("orders.customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(DETAIL_CAP),
    supabase
      .from("grievance_tickets")
      .select(
        `id, ticket_no, category, status, priority, created_at, resolved_at, reopened_count,
         order_id, resolution_note,
         restaurants ( name ),
         profiles!grievance_tickets_assignee_id_fkey ( name )`
      )
      .eq("requester_id", customerId)
      .order("created_at", { ascending: false })
      .limit(DETAIL_CAP),
    supabase
      .from("ratings")
      .select("id, order_id, stars, comment, created_at, restaurants ( name )")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(DETAIL_CAP),
    supabase
      .from("customer_admin_notes")
      .select("id, body, created_at, profiles!customer_admin_notes_author_id_fkey ( name, role )")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(DETAIL_CAP),
    supabase
      .from("customer_flags")
      .select(
        `id, flag, reason, created_at, cleared_at, clear_reason,
         created:profiles!customer_flags_created_by_fkey ( name ),
         cleared:profiles!customer_flags_cleared_by_fkey ( name )`
      )
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(DETAIL_CAP),
    // §7.2 "Account & Security … disable/reactivate and access/security history".
    // audit_logs is the only place this schema records it.
    supabase
      .from("audit_logs")
      .select("id, action, actor_role, reason, created_at, profiles ( name )")
      .eq("target_table", "profiles")
      .eq("target_id", customerId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const orderRows = (orders.data ?? []) as unknown as {
    id: string;
    status: OrderStatus;
    created_at: string;
    pickup_time: string | null;
    ready_at: string | null;
    collected_at: string | null;
    cancelled_at: string | null;
    no_show_at: string | null;
    restaurant_id: string;
    subtotal_paise: number;
    group_id: string | null;
    scan_token: string | null;
    restaurants: { name: string } | null;
    order_items: { name_snapshot: string; quantity: number }[] | null;
  }[];

  const ticketRows = (tickets.data ?? []) as unknown as {
    id: string;
    ticket_no: number | null;
    category: string;
    status: string;
    priority: string;
    created_at: string;
    resolved_at: string | null;
    reopened_count: number;
    order_id: string | null;
    resolution_note: string | null;
    restaurants: { name: string } | null;
    profiles: { name: string | null } | null;
  }[];

  // A second round, because both queries need ids the first round produced. Message
  // counts come from a flat scan rather than a nested `count` aggregate so the
  // result does not depend on which PostgREST version the project runs.
  const ticketIds = ticketRows.map((t) => t.id);
  const groupIds = [...new Set(orderRows.map((o) => o.group_id).filter((g): g is string => Boolean(g)))];

  const [messages, groupOrders] = await Promise.all([
    ticketIds.length > 0
      ? supabase.from("grievance_messages").select("ticket_id").in("ticket_id", ticketIds).limit(5_000)
      : Promise.resolve({ data: [] }),
    groupIds.length > 0
      ? supabase.from("orders").select("id, group_id").in("group_id", groupIds).limit(5_000)
      : Promise.resolve({ data: [] }),
  ]);

  const messageCounts = new Map<string, number>();
  for (const m of (messages.data ?? []) as { ticket_id: string }[]) {
    messageCounts.set(m.ticket_id, (messageCounts.get(m.ticket_id) ?? 0) + 1);
  }

  const ordersByGroup = new Map<string, string[]>();
  for (const o of (groupOrders.data ?? []) as { id: string; group_id: string | null }[]) {
    if (!o.group_id) continue;
    const list = ordersByGroup.get(o.group_id);
    if (list) list.push(o.id);
    else ordersByGroup.set(o.group_id, [o.id]);
  }

  const orderList: Customer360Order[] = orderRows.map((o) => {
    const items = o.order_items ?? [];
    return {
      id: o.id,
      status: o.status,
      createdAt: o.created_at,
      pickupTime: o.pickup_time,
      readyAt: o.ready_at,
      collectedAt: o.collected_at,
      cancelledAt: o.cancelled_at,
      noShowAt: o.no_show_at,
      restaurantId: o.restaurant_id,
      restaurantName: o.restaurants?.name ?? "Unknown restaurant",
      subtotalPaise: o.subtotal_paise,
      itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
      // `name_snapshot`, not the product's current name: the customer ordered what
      // the menu said that day (§11.5).
      itemSummary: items
        .slice(0, 3)
        .map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.name_snapshot}` : i.name_snapshot))
        .join(", ")
        .concat(items.length > 3 ? `, +${items.length - 3} more` : ""),
      groupId: o.group_id,
      qrIssued: Boolean(o.scan_token),
    };
  });

  const paymentList: Customer360Payment[] = (
    (payments.data ?? []) as {
      id: string;
      status: string;
      amount_paise: number;
      razorpay_order_id: string | null;
      razorpay_payment_id: string | null;
      created_at: string;
      group_id: string | null;
    }[]
  ).map((pay) => ({
    id: pay.id,
    status: pay.status,
    amountPaise: pay.amount_paise,
    razorpayOrderId: pay.razorpay_order_id,
    razorpayPaymentId: pay.razorpay_payment_id,
    createdAt: pay.created_at,
    groupId: pay.group_id,
    orderIds: pay.group_id ? ordersByGroup.get(pay.group_id) ?? [] : [],
  }));

  const refundList: Customer360Refund[] = (
    (refunds.data ?? []) as unknown as {
      id: string;
      order_id: string;
      amount_paise: number;
      status: string;
      razorpay_refund_id: string | null;
      grievance_ticket_id: string | null;
      created_at: string;
    }[]
  ).map((r) => ({
    id: r.id,
    orderId: r.order_id,
    amountPaise: r.amount_paise,
    status: r.status,
    razorpayRefundId: r.razorpay_refund_id,
    grievanceTicketId: r.grievance_ticket_id,
    createdAt: r.created_at,
  }));

  const ticketList: Customer360Ticket[] = ticketRows.map((t) => ({
    id: t.id,
    ticketNo: t.ticket_no,
    category: t.category,
    status: t.status,
    priority: t.priority,
    createdAt: t.created_at,
    resolvedAt: t.resolved_at,
    reopenedCount: t.reopened_count,
    restaurantName: t.restaurants?.name ?? null,
    orderId: t.order_id,
    assigneeName: t.profiles?.name ?? null,
    messageCount: messageCounts.get(t.id) ?? 0,
    resolutionNote: t.resolution_note,
  }));

  const ratingList: Customer360Rating[] = (
    (ratings.data ?? []) as unknown as {
      id: string;
      order_id: string;
      stars: number;
      comment: string | null;
      created_at: string;
      restaurants: { name: string } | null;
    }[]
  ).map((r) => ({
    id: r.id,
    orderId: r.order_id,
    stars: r.stars,
    comment: r.comment,
    createdAt: r.created_at,
    restaurantName: r.restaurants?.name ?? "Unknown restaurant",
  }));

  const noteList: AdminNote[] = (
    (notes.data ?? []) as unknown as {
      id: string;
      body: string;
      created_at: string;
      profiles: { name: string | null; role: string } | null;
    }[]
  ).map((n) => ({
    id: n.id,
    body: n.body,
    createdAt: n.created_at,
    authorName: n.profiles?.name ?? null,
    authorRole: n.profiles?.role ?? null,
  }));

  const flagRows = (flags.data ?? []) as unknown as {
    id: string;
    flag: string;
    reason: string;
    created_at: string;
    cleared_at: string | null;
    clear_reason: string | null;
    created: { name: string | null } | null;
    cleared: { name: string | null } | null;
  }[];

  const manualFlags: ManualFlag[] = flagRows
    .filter((f) => f.cleared_at === null)
    .map((f) => ({
      id: f.id,
      flag: f.flag,
      reason: f.reason,
      createdAt: f.created_at,
      createdByName: f.created?.name ?? null,
    }));

  const clearedFlags = flagRows
    .filter((f): f is typeof f & { cleared_at: string } => f.cleared_at !== null)
    .map((f) => ({
      id: f.id,
      flag: f.flag,
      reason: f.reason,
      createdAt: f.created_at,
      createdByName: f.created?.name ?? null,
      clearedAt: f.cleared_at,
      clearedByName: f.cleared?.name ?? null,
      clearReason: f.clear_reason,
    }));

  const securityEvents: Customer360SecurityEvent[] = (
    (audit.data ?? []) as unknown as {
      id: string;
      action: string;
      actor_role: string | null;
      reason: string | null;
      created_at: string;
      profiles: { name: string | null } | null;
    }[]
  ).map((a) => ({
    id: a.id,
    action: a.action,
    actorName: a.profiles?.name ?? null,
    actorRole: a.actor_role,
    reason: a.reason,
    createdAt: a.created_at,
  }));

  // The overview is recomputed from THIS customer's full history rather than read
  // from the directory's capped global pass, so the 360 view is exact even when the
  // list page had to report `truncated`. Both use the same `deriveCustomerFlags`,
  // so a flag can never appear on one screen and not the other.
  const agg = emptyAggregate();
  for (const o of orderRows) {
    agg.orderCount += 1;
    if (agg.lastOrderAt === null) agg.lastOrderAt = o.created_at;
    if (REALIZED.has(o.status)) {
      agg.realizedCount += 1;
      agg.lifetimeSpendPaise += o.subtotal_paise;
    }
    if (o.status === "cancelled") agg.cancelledCount += 1;
    if (o.status === "no_show") agg.noShowCount += 1;
    if (o.status === "refunded" || o.status === "refund_pending") agg.refundedCount += 1;
    if (o.status === "payment_pending") agg.paymentProblemCount += 1;
  }
  for (const r of ratingList) {
    agg.ratingCount += 1;
    agg.starSum += r.stars;
  }
  const openIssueCount = ticketList.filter((t) =>
    (OPEN_GRIEVANCE_STATUSES as readonly string[]).includes(t.status)
  ).length;
  agg.openIssueCount = openIssueCount;
  agg.paymentProblemCount += paymentList.filter((pay) => pay.status === "failed").length;

  const affinityMap = new Map<string, AffinityRow>();
  for (const o of orderRows) {
    const existing = affinityMap.get(o.restaurant_id) ?? {
      restaurantId: o.restaurant_id,
      restaurantName: o.restaurants?.name ?? "Unknown restaurant",
      orderCount: 0,
      spendPaise: 0,
      lastOrderAt: null,
    };
    existing.orderCount += 1;
    // Spend is realized-only, matching lifetime spend. A cancelled order at a
    // restaurant is not affinity, and counting it would make a customer look loyal
    // to the place they keep walking away from.
    if (REALIZED.has(o.status)) existing.spendPaise += o.subtotal_paise;
    if (existing.lastOrderAt === null) existing.lastOrderAt = o.created_at;
    affinityMap.set(o.restaurant_id, existing);
  }
  const affinity = [...affinityMap.values()].sort(
    (a, b) => b.spendPaise - a.spendPaise || b.orderCount - a.orderCount
  );

  const timeline = buildTimeline({
    joinedAt: p.created_at,
    orders: orderList,
    payments: paymentList,
    refunds: refundList,
    ratings: ratingList,
    tickets: ticketList,
    notes: noteList,
    flags: flagRows,
    security: securityEvents,
  });

  return {
    profile: {
      id: p.id,
      name: p.name,
      email: p.email,
      phone: p.phone,
      course: p.course,
      accountStatus: p.status === "disabled" ? "disabled" : "active",
      joinedAt: p.created_at,
      updatedAt: p.updated_at,
    },
    overview: {
      orderCount: agg.orderCount,
      realizedCount: agg.realizedCount,
      cancelledCount: agg.cancelledCount,
      noShowCount: agg.noShowCount,
      refundedCount: agg.refundedCount,
      lifetimeSpendPaise: agg.lifetimeSpendPaise,
      averageOrderPaise:
        agg.realizedCount > 0 ? Math.round(agg.lifetimeSpendPaise / agg.realizedCount) : null,
      averageStars: agg.ratingCount > 0 ? Math.round((agg.starSum / agg.ratingCount) * 100) / 100 : null,
      ratingCount: agg.ratingCount,
      openIssueCount,
      totalIssueCount: ticketList.length,
      lastActivityAt: timeline[0]?.at ?? null,
    },
    derivedFlags: deriveCustomerFlags(agg),
    manualFlags,
    clearedFlags,
    orders: orderList,
    payments: paymentList,
    refunds: refundList,
    grievances: ticketList,
    ratings: ratingList,
    affinity,
    notes: noteList,
    securityEvents,
    timeline,
  };
}

/**
 * The §7.2 activity timeline.
 *
 * Every entry is derived from a row already loaded for another section, which is
 * what keeps the timeline and the tables consistent. Two honest gaps are worth
 * naming rather than papering over:
 *
 *  - "QR issued" has no timestamp of its own. `orders.scan_token` records that a
 *    token exists, not when it was minted, so QR issuance is reported on the order
 *    entry instead of as a dated event of its own. Inventing a timestamp from
 *    `created_at` would put a fact in the timeline that the database never stated.
 *  - "login / account events" and active sessions live in Supabase's `auth` schema,
 *    which this console does not read. What IS evidenced — the account being
 *    disabled or re-enabled by an admin, with actor and reason — comes from
 *    `audit_logs` and appears here.
 *
 * Collection is labelled as the scan, because collection only happens through a
 * scan: `collected_at` IS the moment the QR was read (§10.5).
 */
function buildTimeline(input: {
  joinedAt: string;
  orders: Customer360Order[];
  payments: Customer360Payment[];
  refunds: Customer360Refund[];
  ratings: Customer360Rating[];
  tickets: Customer360Ticket[];
  notes: AdminNote[];
  flags: { id: string; flag: string; created_at: string; cleared_at: string | null }[];
  security: Customer360SecurityEvent[];
}): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const money = (paise: number) => paiseToRupeesDisplay(paise);

  events.push({
    key: "account-created",
    at: input.joinedAt,
    kind: "account",
    label: "Account created",
    detail: null,
    href: null,
  });

  for (const o of input.orders) {
    const href = `/admin/orders/${o.id}`;
    events.push({
      key: `${o.id}-placed`,
      at: o.createdAt,
      kind: "order",
      label: "Order placed",
      detail: `${o.restaurantName} — ${money(o.subtotalPaise)}${o.qrIssued ? " — pickup QR issued" : ""}`,
      href,
    });
    if (o.readyAt) {
      events.push({
        key: `${o.id}-ready`,
        at: o.readyAt,
        kind: "order",
        label: "Marked ready for pickup",
        detail: o.restaurantName,
        href,
      });
    }
    if (o.collectedAt) {
      events.push({
        key: `${o.id}-collected`,
        at: o.collectedAt,
        kind: "order",
        label: "QR scanned — order collected",
        detail: o.restaurantName,
        href,
      });
    }
    if (o.cancelledAt) {
      events.push({
        key: `${o.id}-cancelled`,
        at: o.cancelledAt,
        kind: "order",
        label: "Order cancelled",
        detail: o.restaurantName,
        href,
      });
    }
    if (o.noShowAt) {
      events.push({
        key: `${o.id}-no-show`,
        at: o.noShowAt,
        kind: "order",
        label: "Marked no-show",
        detail: `${o.restaurantName} — paid for and never collected`,
        href,
      });
    }
  }

  for (const pay of input.payments) {
    const label =
      pay.status === "captured"
        ? "Payment verified"
        : pay.status === "failed"
          ? "Payment failed"
          : pay.status === "refunded"
            ? "Payment refunded"
            : `Payment ${pay.status}`;
    events.push({
      key: `${pay.id}-payment`,
      at: pay.createdAt,
      kind: "payment",
      label,
      detail: `${money(pay.amountPaise)}${pay.orderIds.length > 1 ? ` across ${pay.orderIds.length} restaurants` : ""}${
        pay.razorpayPaymentId ? ` — ${pay.razorpayPaymentId}` : ""
      }`,
      href: pay.orderIds[0] ? `/admin/orders/${pay.orderIds[0]}` : null,
    });
  }

  for (const r of input.refunds) {
    events.push({
      key: `${r.id}-refund`,
      at: r.createdAt,
      kind: "refund",
      label: `Refund ${r.status}`,
      detail: money(r.amountPaise),
      href: `/admin/orders/${r.orderId}`,
    });
  }

  for (const r of input.ratings) {
    events.push({
      key: `${r.id}-rating`,
      at: r.createdAt,
      kind: "rating",
      label: `Rated ${r.stars} of 5`,
      detail: r.comment?.trim() ? `${r.restaurantName} — “${r.comment.trim()}”` : r.restaurantName,
      href: `/admin/orders/${r.orderId}`,
    });
  }

  for (const t of input.tickets) {
    const href = `/admin/grievances/${t.id}`;
    const reference = t.ticketNo ? `#${t.ticketNo}` : "Ticket";
    events.push({
      key: `${t.id}-opened`,
      at: t.createdAt,
      kind: "grievance",
      label: `Support ticket ${reference} opened`,
      detail: `${t.category.replace(/_/g, " ")} — ${t.priority} priority`,
      href,
    });
    if (t.resolvedAt) {
      events.push({
        key: `${t.id}-resolved`,
        at: t.resolvedAt,
        kind: "grievance",
        label: `Ticket ${reference} resolved`,
        detail: t.resolutionNote?.trim() || null,
        href,
      });
    }
  }

  for (const f of input.flags) {
    events.push({
      key: `${f.id}-flag`,
      at: f.created_at,
      kind: "flag",
      label: `Flag added: ${f.flag}`,
      detail: null,
      href: null,
    });
    if (f.cleared_at) {
      events.push({
        key: `${f.id}-flag-cleared`,
        at: f.cleared_at,
        kind: "flag",
        label: `Flag cleared: ${f.flag}`,
        detail: null,
        href: null,
      });
    }
  }

  for (const n of input.notes) {
    events.push({
      key: `${n.id}-note`,
      at: n.createdAt,
      kind: "note",
      label: `Internal note by ${n.authorName ?? "an admin"}`,
      // The note body is NOT repeated here. It is internal-only text and the
      // timeline is the one section an operator screen-shares; the Notes section is
      // where it belongs.
      detail: null,
      href: null,
    });
  }

  for (const s of input.security) {
    events.push({
      key: `${s.id}-security`,
      at: s.createdAt,
      kind: "account",
      label: humaniseAction(s.action),
      detail: [s.actorName ?? "System", s.reason?.trim()].filter(Boolean).join(" — ") || null,
      href: null,
    });
  }

  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/**
 * `profile.disabled` → "Account disabled". Kept local rather than reusing the
 * generic `humanise` in lib/admin/format.ts because these strings are read as
 * sentences in a timeline, not as column headers.
 */
function humaniseAction(action: string): string {
  switch (action) {
    case "profile.disabled":
      return "Account disabled by an admin";
    case "profile.reenabled":
      return "Account re-enabled by an admin";
    default:
      return action.replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());
  }
}




























