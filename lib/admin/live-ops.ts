import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getLiveOpsThresholds } from "@/lib/platform/settings";
import { IN_FLIGHT_STATUSES } from "@/lib/orders/status-groups";
import { evaluateSla, formatSlaRemaining } from "@/lib/grievance/sla";
import { bucketToSlotStart } from "@/lib/scheduling/capacity";
import { campusIsoDate, campusDayOfWeek } from "@/lib/scheduling/timezone";
import { paiseToRupeesDisplay } from "@/lib/money";
import { fmtRelative, fmtTime, shortId } from "@/lib/admin/format";
import { fraudSignalLabel } from "@/lib/fraud/flags";

/**
 * Super Admin Live Operations Command Center (SRS V2 §F).
 *
 * §F lists eleven alert classes and §F.1 constrains how they must behave. Four
 * of those constraints are load-bearing for the design here:
 *
 *  - "Every alert links to the underlying order, restaurant, grievance, payment,
 *    QR or payout record." So every alert carries an `href`, and the type makes
 *    it non-optional. An alert an operator cannot act on is noise, and an
 *    optional link is how half of them quietly end up without one.
 *
 *  - "Live data is server-authoritative." Every threshold comparison happens
 *    here against a single `now`, not in the browser. Two consequences: the page
 *    cannot disagree with itself between tiles, and a client with a skewed clock
 *    cannot invent or hide an overdue order.
 *
 *  - "V1 does not require permanent Realtime subscriptions... periodic
 *    refresh/server aggregation is acceptable." Hence one aggregation function
 *    the page re-runs on an interval, rather than eleven subscriptions.
 *
 *  - "Operational alerts must be auditable when acknowledged/resolved." Acks
 *    live in `operational_alert_acks` and are joined onto the alerts here, so an
 *    acknowledged alert stays visible but stops shouting. It is NOT filtered
 *    out: an acknowledged overdue pickup is still an overdue pickup, and hiding
 *    it would let "I've seen it" masquerade as "it's handled".
 *
 * This is deliberately one function returning all eleven groups rather than
 * eleven exported readers. The page renders them together and the whole point
 * of a command center is a single consistent snapshot; separate readers invoked
 * from separate components would each see a different `now`.
 */

export type AlertSeverity = "critical" | "warning" | "info";

/** The alert-type keys, which are also the values stored in `operational_alert_acks.alert_type`. */
export const ALERT_TYPES = {
  duePickupSoon: "order_due_pickup_soon",
  notStarted: "order_not_started",
  notReady: "order_not_ready",
  overduePickup: "order_overdue_pickup",
  restaurantPaused: "restaurant_paused",
  capacityPressure: "restaurant_capacity_pressure",
  paymentException: "payment_exception",
  scanSuspicion: "scan_suspicion",
  grievanceEscalation: "grievance_escalation",
  payoutAwaitingAck: "payout_awaiting_ack",
  restaurantCancellation: "restaurant_cancellation",
} as const;

export type AlertType = (typeof ALERT_TYPES)[keyof typeof ALERT_TYPES];

export type LiveAlert = {
  /** Stable within a group; the ack key together with `type`. */
  targetId: string;
  targetTable: string;
  title: string;
  /** The operational fact, e.g. "pickup 12m ago · Rs 240". */
  detail: string;
  href: string;
  severity: AlertSeverity;
  restaurantId: string | null;
  restaurantName: string | null;
  ack: { at: string; by: string | null; note: string | null } | null;
};

export type LiveAlertGroup = {
  type: AlertType;
  label: string;
  /** Why this group exists, shown under the heading so an operator can act without the SRS. */
  description: string;
  severity: AlertSeverity;
  count: number;
  /** Bounded; `count` is the true total. */
  items: LiveAlert[];
  /** How many of `count` have an active acknowledgement. */
  ackedCount: number;
};

export type LiveOperations = {
  generatedAt: string;
  /** Unacknowledged critical + warning alerts across all groups — the headline number. */
  actionableCount: number;
  groups: LiveAlertGroup[];
  thresholds: Awaited<ReturnType<typeof getLiveOpsThresholds>>;
};

/** Max rows shown per group. The count is exact; the list is a work queue, not a report. */
const GROUP_LIMIT = 25;

type AckRow = {
  alert_type: string;
  target_id: string | null;
  created_at: string;
  note: string | null;
  acknowledged_by: string;
  profiles: { name: string | null } | null;
};

export async function getLiveOperations(now: Date = new Date()): Promise<LiveOperations> {
  const supabase = createServerSupabaseClient();
  const thresholds = await getLiveOpsThresholds();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  const plusMinutes = (m: number) => new Date(nowMs + m * 60_000).toISOString();
  const minusMinutes = (m: number) => new Date(nowMs - m * 60_000).toISOString();

  const [
    liveOrders,
    pausedRestaurants,
    capacityOrders,
    restaurantConfig,
    capacityOverrides,
    paymentExceptions,
    orphanPayments,
    scanFlags,
    tickets,
    payouts,
    cancellations,
    acks,
  ] = await Promise.all([
    // One read covering the four order-based alert classes. Splitting it into
    // four queries would multiply round-trips AND allow the four tiles to
    // disagree about a single order that changed status between them.
    supabase
      .from("orders")
      .select(
        "id, status, pickup_time, ready_at, subtotal_paise, restaurant_id, created_at, restaurants(name)"
      )
      .in("status", IN_FLIGHT_STATUSES as unknown as string[])
      .lte("pickup_time", plusMinutes(Math.max(thresholds.dueSoonMinutes, 180)))
      .order("pickup_time", { ascending: true })
      .limit(500),
    supabase
      .from("restaurants")
      .select("id, name, status, paused_until, paused_reason, closed_at, closed_reason")
      .in("status", ["paused", "closed"])
      .limit(200),
    // Capacity pressure looks forward, not back: a slot that is already past
    // cannot be relieved, so warning about it is pure noise.
    //
    // The excluded statuses are exactly countOrdersInSlot()'s list, including
    // payment_pending. If this page counted an abandoned Razorpay checkout
    // against capacity it would warn about slots that checkout still considers
    // open, and an operator would raise capacity that was never consumed.
    supabase
      .from("orders")
      .select("restaurant_id, pickup_time")
      .not("status", "in", "(cart,payment_pending,cancelled,refunded,no_show)")
      .gte("pickup_time", nowIso)
      .lte("pickup_time", plusMinutes(180))
      .limit(2_000),
    supabase
      .from("restaurants")
      .select("id, name, pickup_slot_interval_minutes, default_slot_capacity")
      .eq("status", "active")
      .limit(500),
    supabase
      .from("pickup_capacity_overrides")
      .select("restaurant_id, day_of_week, specific_date, slot_start, capacity")
      .limit(2_000),
    // A payment stuck short of 'captured' long enough that the customer has
    // either lost money or lost an order — §F "payment/order exceptions
    // requiring manual attention".
    supabase
      .from("payments")
      .select("id, status, amount_paise, customer_id, razorpay_order_id, created_at")
      .in("status", ["created", "authorized", "failed"])
      .lt("created_at", minusMinutes(15))
      .order("created_at", { ascending: false })
      .limit(200),
    // Orders whose payment never completed but which are still sitting in
    // payment_pending: the mirror image of the above, seen from the order side.
    supabase
      .from("orders")
      .select("id, subtotal_paise, created_at, restaurant_id, restaurants(name)")
      .eq("status", "payment_pending")
      .lt("created_at", minusMinutes(15))
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("fraud_flags")
      .select("id, subject_type, subject_id, signal, occurrences, last_seen_at, status")
      .in("status", ["open", "investigating"])
      .in("subject_type", ["qr"])
      .order("last_seen_at", { ascending: false })
      .limit(200),
    supabase
      .from("grievance_tickets")
      .select(
        "id, priority, status, category, restaurant_id, first_response_at, first_response_due_at, resolved_at, resolution_due_at, created_at, restaurants(name)"
      )
      .not("status", "in", "(resolved,closed)")
      .limit(500),
    // 'paid' = money sent, vendor has not confirmed receipt (SRS §12).
    supabase
      .from("disbursements")
      .select("id, restaurant_id, amount_paise, created_at, status, restaurants(name)")
      .eq("status", "paid")
      .order("created_at", { ascending: true })
      .limit(200),
    supabase
      .from("restaurant_cancellation_events")
      .select(
        "id, order_id, restaurant_id, reason, penalty_amount_paise, created_at, restaurants(name)"
      )
      .gte("created_at", minusMinutes(60 * 24))
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("operational_alert_acks")
      .select("alert_type, target_id, created_at, note, acknowledged_by, profiles!operational_alert_acks_acknowledged_by_fkey(name)")
      .is("cleared_at", null)
      .limit(2_000),
  ]);

  // ── ack index ────────────────────────────────────────────────────────────
  const ackIndex = new Map<string, LiveAlert["ack"]>();
  for (const row of (acks.data ?? []) as unknown as AckRow[]) {
    if (!row.target_id) continue;
    ackIndex.set(`${row.alert_type}::${row.target_id}`, {
      at: row.created_at,
      by: row.profiles?.name ?? null,
      note: row.note,
    });
  }
  const ackFor = (type: AlertType, targetId: string) => ackIndex.get(`${type}::${targetId}`) ?? null;

  const groups: LiveAlertGroup[] = [];

  function pushGroup(
    type: AlertType,
    label: string,
    description: string,
    severity: AlertSeverity,
    all: LiveAlert[]
  ) {
    groups.push({
      type,
      label,
      description,
      severity,
      count: all.length,
      ackedCount: all.filter((a) => a.ack !== null).length,
      items: all.slice(0, GROUP_LIMIT),
    });
  }

  // ── order-derived alerts ─────────────────────────────────────────────────
  type OrderRow = {
    id: string;
    status: string;
    pickup_time: string;
    ready_at: string | null;
    subtotal_paise: number;
    restaurant_id: string;
    created_at: string;
    restaurants: { name: string } | null;
  };
  const orders = (liveOrders.data ?? []) as unknown as OrderRow[];

  const orderAlert = (
    o: OrderRow,
    type: AlertType,
    severity: AlertSeverity,
    detail: string
  ): LiveAlert => ({
    targetId: o.id,
    targetTable: "orders",
    title: `Order ${shortId(o.id)} · ${o.restaurants?.name ?? "Unknown restaurant"}`,
    detail,
    href: `/admin/orders/${o.id}`,
    severity,
    restaurantId: o.restaurant_id,
    restaurantName: o.restaurants?.name ?? null,
    ack: ackFor(type, o.id),
  });

  const minutesTo = (iso: string) => Math.round((new Date(iso).getTime() - nowMs) / 60_000);

  pushGroup(
    ALERT_TYPES.overduePickup,
    "Orders past pickup time",
    "Paid, prepared, and nobody has collected them. Each one is a customer who may be about to open a ticket.",
    "critical",
    orders
      .filter((o) => minutesTo(o.pickup_time) < -thresholds.pickupOverdueMinutes)
      .map((o) =>
        orderAlert(
          o,
          ALERT_TYPES.overduePickup,
          "critical",
          `Pickup ${fmtRelative(o.pickup_time, now)} (${fmtTime(o.pickup_time)}) · ${paiseToRupeesDisplay(o.subtotal_paise)} · ${o.status === "ready_for_pickup" ? "waiting at counter" : "not marked ready"}`
        )
      )
  );

  pushGroup(
    ALERT_TYPES.notReady,
    "Not ready after expected readiness",
    "Past the readiness point with no ready mark. The automatic T+5 readiness rule should have covered these, so a gap here means the order genuinely has not been made.",
    "critical",
    orders
      .filter(
        (o) =>
          o.ready_at === null &&
          o.status !== "ready_for_pickup" &&
          minutesTo(o.pickup_time) < -thresholds.readyOverdueMinutes
      )
      .map((o) =>
        orderAlert(
          o,
          ALERT_TYPES.notReady,
          "critical",
          `Pickup was ${fmtTime(o.pickup_time)}, ${fmtRelative(o.pickup_time, now)} · still ${o.status.replace(/_/g, " ")}`
        )
      )
  );

  pushGroup(
    ALERT_TYPES.notStarted,
    "Not started preparing",
    `Pickup is inside ${thresholds.notStartedMinutesBeforePickup} minutes and the kitchen has not begun. This is the last group where a phone call still fixes the outcome.`,
    "warning",
    orders
      .filter((o) => {
        const mins = minutesTo(o.pickup_time);
        return (
          (o.status === "paid" || o.status === "scheduled") &&
          mins <= thresholds.notStartedMinutesBeforePickup &&
          mins >= -thresholds.pickupOverdueMinutes
        );
      })
      .map((o) =>
        orderAlert(
          o,
          ALERT_TYPES.notStarted,
          "warning",
          `Pickup ${fmtRelative(o.pickup_time, now)} (${fmtTime(o.pickup_time)}) · ${paiseToRupeesDisplay(o.subtotal_paise)}`
        )
      )
  );

  pushGroup(
    ALERT_TYPES.duePickupSoon,
    "Due for pickup soon",
    `Pickup within ${thresholds.dueSoonMinutes} minutes. Informational — the workload about to arrive at the counters.`,
    "info",
    orders
      .filter((o) => {
        const mins = minutesTo(o.pickup_time);
        return mins >= 0 && mins <= thresholds.dueSoonMinutes;
      })
      .map((o) =>
        orderAlert(
          o,
          ALERT_TYPES.duePickupSoon,
          "info",
          `Pickup ${fmtRelative(o.pickup_time, now)} (${fmtTime(o.pickup_time)}) · ${o.status === "ready_for_pickup" ? "ready" : o.status.replace(/_/g, " ")}`
        )
      )
  );

  // ── restaurants paused / closed ──────────────────────────────────────────
  type PausedRow = {
    id: string;
    name: string;
    status: string;
    paused_until: string | null;
    paused_reason: string | null;
    closed_at: string | null;
    closed_reason: string | null;
  };
  pushGroup(
    ALERT_TYPES.restaurantPaused,
    "Restaurants not accepting orders",
    "Paused or closed restaurants. A pause whose timer has already elapsed is called out separately — it is stale state, not an operational decision.",
    "warning",
    ((pausedRestaurants.data ?? []) as unknown as PausedRow[]).map((r) => {
      const elapsed = r.status === "paused" && r.paused_until !== null && new Date(r.paused_until).getTime() <= nowMs;
      const detail =
        r.status === "closed"
          ? `Closed${r.closed_reason ? ` — ${r.closed_reason}` : ""}${r.closed_at ? ` · since ${fmtTime(r.closed_at)}` : ""}`
          : elapsed
            ? `Pause expired ${fmtRelative(r.paused_until, now)} but the restaurant is still marked paused — needs a resume`
            : r.paused_until
              ? `Paused until ${fmtTime(r.paused_until)} (${fmtRelative(r.paused_until, now)})${r.paused_reason ? ` — ${r.paused_reason}` : ""}`
              : `Paused until manually reopened${r.paused_reason ? ` — ${r.paused_reason}` : ""}`;
      return {
        targetId: r.id,
        targetTable: "restaurants",
        title: r.name,
        detail,
        href: `/admin/restaurants/${r.id}/dashboard`,
        severity: (elapsed ? "critical" : "warning") as AlertSeverity,
        restaurantId: r.id,
        restaurantName: r.name,
        ack: ackFor(ALERT_TYPES.restaurantPaused, r.id),
      };
    })
  );

  // ── capacity pressure ────────────────────────────────────────────────────
  // Computed in-process from three bulk reads rather than by calling
  // remainingCapacity() per slot: that helper issues two queries per slot, and
  // "every active restaurant × the next three hours of slots" would be hundreds
  // of round-trips on a page that refreshes on a timer.
  type ConfigRow = {
    id: string;
    name: string;
    pickup_slot_interval_minutes: number;
    default_slot_capacity: number;
  };
  type OverrideRow = {
    restaurant_id: string;
    day_of_week: number | null;
    specific_date: string | null;
    slot_start: string;
    capacity: number;
  };
  const configs = new Map(
    ((restaurantConfig.data ?? []) as unknown as ConfigRow[]).map((r) => [r.id, r])
  );
  const overrides = (capacityOverrides.data ?? []) as unknown as OverrideRow[];

  const slotLoad = new Map<string, { restaurantId: string; slotStart: string; date: string; count: number }>();
  for (const row of (capacityOrders.data ?? []) as unknown as { restaurant_id: string; pickup_time: string }[]) {
    const config = configs.get(row.restaurant_id);
    if (!config) continue;
    const at = new Date(row.pickup_time);
    const slotStart = bucketToSlotStart(at, config.pickup_slot_interval_minutes);
    const date = campusIsoDate(at);
    const key = `${row.restaurant_id}::${date}::${slotStart}`;
    const existing = slotLoad.get(key);
    if (existing) existing.count += 1;
    else slotLoad.set(key, { restaurantId: row.restaurant_id, slotStart, date, count: 1 });
  }

  function capacityFor(restaurantId: string, date: string, slotStart: string): number {
    const config = configs.get(restaurantId);
    if (!config) return 0;
    // Specific date beats weekday beats default — the same precedence
    // resolveSlotCapacity() applies, kept identical on purpose so the command
    // center and checkout never disagree about whether a slot is full.
    // Compared on HH:MM because a postgres `time` column round-trips as
    // "HH:MM:SS" and bucketToSlotStart always produces ":00" seconds.
    const sameSlot = (o: OverrideRow) => o.slot_start.slice(0, 5) === slotStart.slice(0, 5);
    const specific = overrides.find(
      (o) => o.restaurant_id === restaurantId && o.specific_date === date && sameSlot(o)
    );
    if (specific) return specific.capacity;
    const dow = campusDayOfWeek(new Date(`${date}T00:00:00Z`));
    const recurring = overrides.find(
      (o) => o.restaurant_id === restaurantId && o.day_of_week === dow && sameSlot(o)
    );
    if (recurring) return recurring.capacity;
    return config.default_slot_capacity;
  }

  const capacityAlerts: LiveAlert[] = [];
  for (const load of slotLoad.values()) {
    const capacity = capacityFor(load.restaurantId, load.date, load.slotStart);
    if (capacity <= 0) continue;
    const ratio = load.count / capacity;
    if (ratio < thresholds.capacityWarningRatio) continue;
    const config = configs.get(load.restaurantId);
    const over = load.count >= capacity;
    // The ack target is the RESTAURANT, not the slot: `target_id` is a uuid
    // column, so a slot key cannot be stored there. Acknowledging capacity
    // pressure at a restaurant therefore quietens all of its pressured slots,
    // which matches the actual remedy — you widen the interval or raise the
    // default capacity for the restaurant, not for 13:15 alone.
    capacityAlerts.push({
      targetId: load.restaurantId,
      targetTable: "restaurants",
      title: `${config?.name ?? "Restaurant"} · ${load.slotStart.slice(0, 5)}`,
      detail: `${load.count} of ${capacity} slots taken${over ? " — at or over capacity" : ` (${Math.round(ratio * 100)}%)`} on ${load.date}`,
      href: `/admin/restaurants/${load.restaurantId}/pickup`,
      severity: over ? "critical" : "warning",
      restaurantId: load.restaurantId,
      restaurantName: config?.name ?? null,
      ack: ackFor(ALERT_TYPES.capacityPressure, load.restaurantId),
    });
  }
  capacityAlerts.sort((a, b) => (a.severity === b.severity ? a.title.localeCompare(b.title) : a.severity === "critical" ? -1 : 1));
  pushGroup(
    ALERT_TYPES.capacityPressure,
    "Pickup slots nearing capacity",
    `Slots in the next three hours at or above ${Math.round(thresholds.capacityWarningRatio * 100)}% of their capacity. Raising capacity or widening the slot is the lever here.`,
    "warning",
    capacityAlerts
  );

  // ── payment / order exceptions ───────────────────────────────────────────
  type PaymentRow = {
    id: string;
    status: string;
    amount_paise: number;
    customer_id: string;
    razorpay_order_id: string | null;
    created_at: string;
  };
  type OrphanOrderRow = {
    id: string;
    subtotal_paise: number;
    created_at: string;
    restaurant_id: string;
    restaurants: { name: string } | null;
  };
  const paymentAlerts: LiveAlert[] = [
    ...((paymentExceptions.data ?? []) as unknown as PaymentRow[]).map((p) => ({
      targetId: p.id,
      targetTable: "payments",
      title: `Payment ${shortId(p.id)} · ${p.status}`,
      detail: `${paiseToRupeesDisplay(p.amount_paise)} stuck in '${p.status}' since ${fmtTime(p.created_at)} (${fmtRelative(p.created_at, now)})${p.razorpay_order_id ? ` · ${p.razorpay_order_id}` : ""}`,
      href: `/admin/payments/reconciliation?payment=${p.id}`,
      severity: (p.status === "authorized" ? "critical" : "warning") as AlertSeverity,
      restaurantId: null,
      restaurantName: null,
      ack: ackFor(ALERT_TYPES.paymentException, p.id),
    })),
    ...((orphanPayments.data ?? []) as unknown as OrphanOrderRow[]).map((o) => ({
      targetId: o.id,
      targetTable: "orders",
      title: `Order ${shortId(o.id)} · payment pending`,
      detail: `${paiseToRupeesDisplay(o.subtotal_paise)} · created ${fmtRelative(o.created_at, now)} and never paid · ${o.restaurants?.name ?? "Unknown restaurant"}`,
      href: `/admin/orders/${o.id}`,
      severity: "warning" as AlertSeverity,
      restaurantId: o.restaurant_id,
      restaurantName: o.restaurants?.name ?? null,
      ack: ackFor(ALERT_TYPES.paymentException, o.id),
    })),
  ];
  pushGroup(
    ALERT_TYPES.paymentException,
    "Payment and order exceptions",
    "Payments that never reached a terminal state and orders that never got a payment. An 'authorized' payment is the serious case: the customer has been charged and holds no order.",
    "critical",
    paymentAlerts
  );

  // ── QR scan suspicion ────────────────────────────────────────────────────
  type FlagRow = {
    id: string;
    subject_type: string;
    subject_id: string;
    signal: string;
    occurrences: number;
    last_seen_at: string;
    status: string;
  };
  pushGroup(
    ALERT_TYPES.scanSuspicion,
    "QR scan failures and suspicious activity",
    "Open QR-subject fraud signals. Recording never blocks a scan (§S), so nothing here has been acted on automatically — a human decision is the only thing that closes one.",
    "warning",
    ((scanFlags.data ?? []) as unknown as FlagRow[]).map((f) => ({
      targetId: f.id,
      targetTable: "fraud_flags",
      title: fraudSignalLabel(f.signal),
      detail: `${f.occurrences} occurrence${f.occurrences === 1 ? "" : "s"} · last ${fmtRelative(f.last_seen_at, now)} · ${f.status}`,
      href: `/admin/audit/fraud?flag=${f.id}`,
      severity: (f.occurrences >= 5 ? "critical" : "warning") as AlertSeverity,
      restaurantId: null,
      restaurantName: null,
      ack: ackFor(ALERT_TYPES.scanSuspicion, f.id),
    }))
  );

  // ── grievances: urgent/high and SLA breaches ─────────────────────────────
  type TicketRow = {
    id: string;
    priority: string;
    status: string;
    category: string;
    restaurant_id: string | null;
    first_response_at: string | null;
    first_response_due_at: string | null;
    resolved_at: string | null;
    resolution_due_at: string | null;
    created_at: string;
    restaurants: { name: string } | null;
  };
  const grievanceAlerts: LiveAlert[] = [];
  for (const t of (tickets.data ?? []) as unknown as TicketRow[]) {
    const sla = evaluateSla(
      {
        status: t.status,
        firstResponseAt: t.first_response_at,
        firstResponseDueAt: t.first_response_due_at,
        resolvedAt: t.resolved_at,
        resolutionDueAt: t.resolution_due_at,
      },
      now
    );
    const urgent = t.priority === "urgent" || t.priority === "high";
    // §F asks for "urgent/high grievances AND SLA breaches" — a breached
    // normal-priority ticket belongs here too, which is why this is an OR.
    if (!urgent && !sla.breached) continue;
    const clock = formatSlaRemaining(sla.minutesRemaining);
    grievanceAlerts.push({
      targetId: t.id,
      targetTable: "grievance_tickets",
      title: `${t.priority.toUpperCase()} · ${t.category.replace(/_/g, " ")}`,
      detail: `${sla.breached ? "SLA breached" : "within SLA"}${clock ? ` · ${clock}` : ""} · opened ${fmtRelative(t.created_at, now)}${t.restaurants?.name ? ` · ${t.restaurants.name}` : ""}`,
      href: `/admin/grievances/${t.id}`,
      severity: sla.breached || t.priority === "urgent" ? "critical" : "warning",
      restaurantId: t.restaurant_id,
      restaurantName: t.restaurants?.name ?? null,
      ack: ackFor(ALERT_TYPES.grievanceEscalation, t.id),
    });
  }
  pushGroup(
    ALERT_TYPES.grievanceEscalation,
    "Urgent grievances and SLA breaches",
    "Urgent or high-priority tickets, plus any priority whose SLA clock has run out. Due times are the ones snapshotted when the ticket opened, so changing the policy does not retroactively breach old tickets.",
    "critical",
    grievanceAlerts
  );

  // ── payouts awaiting acknowledgement ─────────────────────────────────────
  type PayoutRow = {
    id: string;
    restaurant_id: string;
    amount_paise: number;
    created_at: string;
    status: string;
    restaurants: { name: string } | null;
  };
  pushGroup(
    ALERT_TYPES.payoutAwaitingAck,
    "Payouts awaiting vendor acknowledgement",
    "Money UNI8 has sent and the vendor has not confirmed. Oldest first — an unacknowledged payout is the open end of a financial loop, and a 'not received' answer becomes a ticket.",
    "warning",
    ((payouts.data ?? []) as unknown as PayoutRow[]).map((d) => ({
      targetId: d.id,
      targetTable: "disbursements",
      title: `${d.restaurants?.name ?? "Restaurant"} · ${paiseToRupeesDisplay(d.amount_paise)}`,
      detail: `Paid ${fmtRelative(d.created_at, now)}, awaiting acknowledgement`,
      href: `/admin/payments/${d.restaurant_id}`,
      severity: (nowMs - new Date(d.created_at).getTime() > 3 * 86_400_000 ? "critical" : "warning") as AlertSeverity,
      restaurantId: d.restaurant_id,
      restaurantName: d.restaurants?.name ?? null,
      ack: ackFor(ALERT_TYPES.payoutAwaitingAck, d.id),
    }))
  );

  // ── restaurant cancellations & penalties ─────────────────────────────────
  type CancellationRow = {
    id: string;
    order_id: string;
    restaurant_id: string;
    reason: string;
    penalty_amount_paise: number;
    created_at: string;
    restaurants: { name: string } | null;
  };
  pushGroup(
    ALERT_TYPES.restaurantCancellation,
    "Restaurant cancellations and penalties",
    "Vendor-initiated cancellations in the last 24 hours, with the penalty each one generated. A cluster at one restaurant is a supply problem, not a run of bad luck.",
    "warning",
    ((cancellations.data ?? []) as unknown as CancellationRow[]).map((c) => ({
      targetId: c.id,
      targetTable: "restaurant_cancellation_events",
      title: `${c.restaurants?.name ?? "Restaurant"} cancelled order ${shortId(c.order_id)}`,
      detail: `Penalty ${paiseToRupeesDisplay(c.penalty_amount_paise)} · ${fmtRelative(c.created_at, now)} · ${c.reason}`,
      href: `/admin/orders/${c.order_id}`,
      severity: "warning" as AlertSeverity,
      restaurantId: c.restaurant_id,
      restaurantName: c.restaurants?.name ?? null,
      ack: ackFor(ALERT_TYPES.restaurantCancellation, c.id),
    }))
  );

  const actionableCount = groups.reduce(
    (sum, g) =>
      sum +
      (g.severity === "info"
        ? 0
        : g.count - g.ackedCount),
    0
  );

  return { generatedAt: nowIso, actionableCount, groups, thresholds };
}
