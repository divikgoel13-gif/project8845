"use client";

import { useState, useTransition } from "react";
import { startPreparing, markReady, markNoShow, cancelOrderByRestaurant } from "@/lib/actions/restaurant/order-status";

/**
 * Order status action buttons (SRS Phase 5: "Operational order
 * statuses"). Shared between the Staff Orders page and the Vendor Admin
 * Orders page — the underlying actions in lib/actions/restaurant/
 * order-status.ts already scope who can do what (cancellation is
 * vendor_admin-only; the rest is available to both), so this component
 * just renders whichever buttons are valid for the order's CURRENT
 * status and lets the server action be the real authority.
 */
export function OrderStatusActions({
  restaurantId,
  orderId,
  status,
  canCancel,
  onStatusChange,
}: {
  restaurantId: string;
  orderId: string;
  status: string;
  canCancel: boolean;
  onStatusChange?: (nextStatus: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  function run(action: () => Promise<void>, nextStatus: string) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
        onStatusChange?.(nextStatus);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not update this order.");
      }
    });
  }

  function handleCancelSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cancelReason.trim()) return;
    run(() => cancelOrderByRestaurant({ restaurantId, orderId, reason: cancelReason.trim() }), "cancelled");
    setShowCancelForm(false);
    setCancelReason("");
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {status === "scheduled" && (
          <button
            onClick={() => run(() => startPreparing({ restaurantId, orderId }), "preparing")}
            disabled={isPending}
            className="rounded-full bg-orange-500 px-3 py-1 text-xs font-semibold text-cream-50 disabled:opacity-50"
          >
            Start preparing
          </button>
        )}
        {status === "preparing" && (
          <button
            onClick={() => run(() => markReady({ restaurantId, orderId }), "ready_for_pickup")}
            disabled={isPending}
            className="rounded-full bg-success text-cream-50 px-3 py-1 text-xs font-semibold disabled:opacity-50"
          >
            Mark ready
          </button>
        )}
        {(status === "ready_for_pickup" || status === "scheduled") && (
          <button
            onClick={() => run(() => markNoShow({ restaurantId, orderId }), "no_show")}
            disabled={isPending}
            className="rounded-full bg-cream-200 px-3 py-1 text-xs font-semibold text-ink-soft disabled:opacity-50"
          >
            Mark no-show
          </button>
        )}
        {canCancel && (status === "scheduled" || status === "preparing") && (
          <button
            onClick={() => setShowCancelForm((v) => !v)}
            disabled={isPending}
            className="rounded-full bg-danger-bg px-3 py-1 text-xs font-semibold text-danger disabled:opacity-50"
          >
            Cancel order
          </button>
        )}
      </div>

      {showCancelForm && (
        <form onSubmit={handleCancelSubmit} className="mt-2 flex flex-col gap-2">
          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Reason for cancelling (required, shown to the customer's support ticket)"
            className="rounded-brand border border-cream-300 bg-cream-50 px-2 py-1 text-xs"
            rows={2}
            required
          />
          <div className="flex gap-2">
            <button type="submit" className="rounded-full bg-danger px-3 py-1 text-xs font-semibold text-cream-50">
              Confirm cancellation
            </button>
            <button
              type="button"
              onClick={() => setShowCancelForm(false)}
              className="rounded-full bg-cream-200 px-3 py-1 text-xs font-medium text-ink-soft"
            >
              Back
            </button>
          </div>
        </form>
      )}

      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
