import { cn } from "@/lib/cn";

/**
 * Status pill. Phases 7-9 render status in roughly forty places (order
 * status, restaurant status, ticket status/priority, reconciliation
 * severity, fraud flag state, SLA breach), and every one of them was about
 * to grow its own `className` string. Centralising the tone→token mapping
 * here is what keeps the palette to the eight semantic colours in
 * tailwind.config.ts instead of drifting into ad-hoc hex values (SRS §26).
 *
 * `tone` is deliberately semantic (what the state MEANS) rather than a
 * colour name, so a caller never has to decide whether "paused" is amber or
 * red — see the mapping helpers below, which are the single place that
 * decision lives.
 */
export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-cream-200 text-ink-soft",
  info: "bg-info-bg text-info",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
  accent: "bg-orange-50 text-orange-700",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        TONE_CLASSES[tone],
        className
      )}
      {...props}
    />
  );
}

/**
 * Order status → tone. Mirrors lib/orders/state-machine.ts semantics: the
 * pre-payment and terminal-failure states read as problems, in-flight
 * fulfilment reads as informational, and only `collected` is a success.
 */
export function orderStatusTone(status: string): BadgeTone {
  switch (status) {
    case "collected":
      return "success";
    case "ready_for_pickup":
      return "accent";
    case "preparing":
    case "scheduled":
    case "paid":
      return "info";
    case "cart":
    case "payment_pending":
      return "neutral";
    case "refund_pending":
      return "warning";
    case "cancelled":
    case "refunded":
    case "no_show":
      return "danger";
    default:
      return "neutral";
  }
}

/**
 * Restaurant status → tone (SRS §6 workspace header must show status).
 *
 * Accepts the four V2.6 §60 states and also the derived states from
 * `restaurantOperationalState` ('paused-until'), because the header renders the
 * derived state, not the stored column.
 */
export function restaurantStatusTone(status: string): BadgeTone {
  switch (status) {
    case "active":
      return "success";
    case "paused":
    case "paused-until":
      return "warning";
    case "closed":
      // Danger rather than warning: unlike a pause, nothing about a closed
      // restaurant resolves itself, so it should not sit in the same visual
      // register as a timed breather.
      return "danger";
    case "archived":
      return "neutral";
    default:
      return "neutral";
  }
}

/** Grievance status → tone (SRS §13 seven statuses). */
export function grievanceStatusTone(status: string): BadgeTone {
  switch (status) {
    case "resolved":
      return "success";
    case "closed":
      return "neutral";
    case "escalated":
      return "danger";
    case "waiting_customer":
    case "waiting_vendor":
      return "warning";
    case "in_review":
      return "info";
    case "open":
      return "accent";
    default:
      return "neutral";
  }
}

/** Grievance priority → tone (SRS §13 four priorities). */
export function grievancePriorityTone(priority: string): BadgeTone {
  switch (priority) {
    case "urgent":
      return "danger";
    case "high":
      return "warning";
    case "normal":
      return "info";
    case "low":
      return "neutral";
    default:
      return "neutral";
  }
}

/** Severity string shared by reconciliation items and announcements. */
export function severityTone(severity: string): BadgeTone {
  switch (severity) {
    case "critical":
      return "danger";
    case "warning":
      return "warning";
    case "info":
      return "info";
    default:
      return "neutral";
  }
}

/** Open/investigating/resolved/dismissed — fraud flags and reconciliation. */
export function reviewStatusTone(status: string): BadgeTone {
  switch (status) {
    case "resolved":
      return "success";
    case "investigating":
      return "info";
    case "dismissed":
    case "ignored":
      return "neutral";
    case "open":
      return "danger";
    default:
      return "neutral";
  }
}

/** Disbursement status → tone (SRS §12 acknowledgement flow). */
export function disbursementStatusTone(status: string): BadgeTone {
  switch (status) {
    case "acknowledged_received":
      return "success";
    case "paid":
      return "info";
    case "pending":
      return "warning";
    case "acknowledged_not_received":
      return "danger";
    default:
      return "neutral";
  }
}
