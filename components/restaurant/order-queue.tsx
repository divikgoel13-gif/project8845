"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { OrderStatusBadge } from "@/components/customer/order-status-badge";
import { OrderStatusActions } from "@/components/restaurant/order-status-actions";
import { paiseToRupeesDisplay } from "@/lib/money";
import type { VendorOrderSummary } from "@/lib/data/vendor-orders";

/**
 * Shared operational order queue — used by both the Staff Orders page and
 * the Vendor Admin Orders page. `showFinancials` is off for Staff (SRS
 * §11: "Staff cannot access vendor finances or customer information
 * beyond what is operationally required" — the order's sale value isn't
 * needed to prepare and hand over a pre-paid pickup order, so it's
 * withheld there specifically) and on for Vendor Admin. `canCancel`
 * mirrors the same vendor_admin-only restriction already enforced
 * server-side in lib/actions/restaurant/order-status.ts.
 */
export function OrderQueue({
  restaurantId,
  orders: initialOrders,
  showFinancials,
  canCancel,
}: {
  restaurantId: string;
  orders: VendorOrderSummary[];
  showFinancials: boolean;
  canCancel: boolean;
}) {
  const [orders, setOrders] = useState(initialOrders);

  function handleStatusChange(orderId: string, nextStatus: string) {
    setOrders((prev) =>
      prev.map((o) => (o.orderId === orderId ? { ...o, status: nextStatus as VendorOrderSummary["status"] } : o))
    );
  }

  if (orders.length === 0) {
    return (
      <Card>
        <p className="text-sm text-ink-soft">No orders match right now.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {orders.map((o) => (
        <Card key={o.orderId}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium">{o.customerName ?? "Customer"}</p>
              <p className="text-xs text-ink-muted">{o.customerPhone ?? "—"}</p>
              <p className="mt-1 text-sm text-ink-soft">
                {o.itemCount} item{o.itemCount === 1 ? "" : "s"}
                {showFinancials && <> · {paiseToRupeesDisplay(o.subtotalPaise)}</>}
              </p>
              <p className="text-sm text-ink-soft">
                Pickup:{" "}
                {o.pickupTime
                  ? new Date(o.pickupTime).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
                  : "—"}
              </p>
            </div>
            <OrderStatusBadge status={o.status} />
          </div>
          <div className="mt-3">
            <OrderStatusActions
              restaurantId={restaurantId}
              orderId={o.orderId}
              status={o.status}
              canCancel={canCancel}
              onStatusChange={(next) => handleStatusChange(o.orderId, next)}
            />
          </div>
        </Card>
      ))}
    </div>
  );
}
