const STATUS_LABELS: Record<string, string> = {
  paid: "Paid",
  scheduled: "Scheduled",
  preparing: "Preparing",
  ready_for_pickup: "Ready for pickup",
  collected: "Collected",
  cancelled: "Cancelled",
  refund_pending: "Refund pending",
  refunded: "Refunded",
  no_show: "Missed pickup",
};

const STATUS_STYLES: Record<string, string> = {
  paid: "bg-info-bg text-info",
  scheduled: "bg-info-bg text-info",
  preparing: "bg-warning-bg text-warning",
  ready_for_pickup: "bg-success-bg text-success",
  collected: "bg-cream-200 text-ink-soft",
  cancelled: "bg-danger-bg text-danger",
  refund_pending: "bg-warning-bg text-warning",
  refunded: "bg-cream-200 text-ink-soft",
  no_show: "bg-danger-bg text-danger",
};

export function OrderStatusBadge({ status }: { status: string }) {
  return (
    <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[status] ?? "bg-cream-200 text-ink-soft"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
