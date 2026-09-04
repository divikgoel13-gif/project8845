import { notFound } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";
import { requireProfile } from "@/lib/auth/guards";
import { getOrderGroupDetail } from "@/lib/data/orders";
import { mapOpenTicketsForOrders } from "@/lib/data/customer-grievances";
import { Card } from "@/components/ui/card";
import { OrderStatusBadge } from "@/components/customer/order-status-badge";
import { PickupCountdown } from "@/components/customer/pickup-countdown";
import { RatingForm } from "@/components/customer/rating-form";
import { ReportIssue, NotReadyPrompt } from "@/components/customer/report-issue";
import { paiseToRupeesDisplay } from "@/lib/money";

/**
 * V2.6 §59 threshold: "the five-minute threshold has elapsed". Kept as a named
 * constant next to its only use rather than in settings, because §59 states the
 * number rather than describing it as configurable.
 */
const NOT_READY_THRESHOLD_MINUTES = 5;

/**
 * Order group detail — the unified QR screen (SRS V2 §J: "A multi-
 * restaurant purchase uses one customer-facing QR. Each restaurant's
 * scanner resolves the same QR but exposes and authorizes only that
 * restaurant's own order/items."). One QR image is rendered for the
 * whole group; each restaurant order underneath shows its own status
 * independently, since collection is atomic per restaurant order even
 * though the QR is shared.
 *
 * This screen is also where the two customer support entry points live, because
 * it is the only screen that already knows which order the customer means:
 *
 *  - V2 §I "Need help / Report an issue" on the relevant order, which
 *    auto-populates order, restaurant, customer and category so the customer
 *    never types an order id;
 *  - V2.6 §59 the "still waiting?" prompt, shown only when an order is
 *    `ready_for_pickup`, uncollected, and ready for longer than the
 *    five-minute threshold.
 *
 * Both are suppressed when a live ticket already exists on that order (§59
 * "duplicate automatic tickets must be prevented"), which is why the open
 * tickets are fetched once here and passed down rather than each card asking.
 *
 * The QR image is generated server-side via the `qrcode` package
 * (data-URL PNG) — this dependency has not been installed/run in this
 * sandbox (no network access); treat as standard-library-grade but
 * unverified here. See docs/KNOWN_ISSUES.md.
 */
export default async function OrderGroupDetailPage({ params }: { params: { groupId: string } }) {
  const profile = await requireProfile();
  const detail = await getOrderGroupDetail(params.groupId, profile.id);
  if (!detail) notFound();

  const openTickets = await mapOpenTicketsForOrders(
    detail.orders.map((o) => o.orderId),
    profile.id
  );

  const qrDataUrl = await QRCode.toDataURL(detail.qrToken, {
    width: 260,
    margin: 2,
    color: { dark: "#241812", light: "#FCF3E2" }, // ink on cream — see tailwind.config.ts
  });

  const anyCollectible = detail.orders.some((o) =>
    ["scheduled", "preparing", "ready_for_pickup"].includes(o.status)
  );

  const now = Date.now();

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">Your pickup</h1>
        <Link href="/support" className="text-sm font-semibold text-maroon-600 underline">
          Support
        </Link>
      </div>

      {anyCollectible && (
        <Card className="mt-6 flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-ink-soft">
            Show this at each restaurant — the same code works for every stop.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL, not a Next-optimizable remote image */}
          <img src={qrDataUrl} alt="Pickup QR code" width={260} height={260} />
        </Card>
      )}

      <div className="mt-6 flex flex-col gap-4">
        {detail.orders.map((o) => {
          const existingTicket = openTickets.get(o.orderId) ?? null;

          // §59 trigger: ready, not collected, and past the threshold. Measured
          // from ready_at; an order marked ready without a timestamp (legacy
          // rows) does not trigger the prompt rather than triggering it wrongly.
          const minutesReady =
            o.status === "ready_for_pickup" && o.readyAt && !o.collectedAt
              ? Math.floor((now - new Date(o.readyAt).getTime()) / 60_000)
              : null;
          const showNotReady = minutesReady !== null && minutesReady >= NOT_READY_THRESHOLD_MINUTES;

          return (
            <Card key={o.orderId}>
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-bold">{o.restaurantName}</h2>
                <OrderStatusBadge status={o.status} />
              </div>
              {o.pickupTime && ["scheduled", "preparing", "ready_for_pickup"].includes(o.status) && (
                <div className="mt-1">
                  <PickupCountdown pickupTimeIso={o.pickupTime} />
                </div>
              )}

              {showNotReady && (
                <NotReadyPrompt
                  orderId={o.orderId}
                  restaurantName={o.restaurantName}
                  minutesWaiting={minutesReady!}
                  existingTicket={existingTicket}
                />
              )}

              <div className="mt-3 flex flex-col gap-1 text-sm">
                {o.items.map((item, i) => (
                  <div key={i} className="flex justify-between">
                    <span>
                      {item.quantity} × {item.name}
                    </span>
                    <span>{paiseToRupeesDisplay(item.pricePaise * item.quantity)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-right text-sm font-medium">
                Subtotal: {paiseToRupeesDisplay(o.subtotalPaise)}
              </p>

              {o.status === "collected" && !o.hasRating && (
                <RatingForm orderId={o.orderId} restaurantId={o.restaurantId} />
              )}
              {o.status === "collected" && o.hasRating && (
                <p className="mt-3 border-t border-cream-300 pt-3 text-sm text-ink-muted">
                  You&apos;ve rated this order.
                </p>
              )}

              {/*
                §I entry point. Not shown alongside the §59 prompt, which is
                already a ticket action for the same order — two "raise a ticket"
                controls on one card is how you get duplicate tickets.
              */}
              {!showNotReady && o.status !== "payment_pending" && (
                <ReportIssue
                  orderId={o.orderId}
                  restaurantName={o.restaurantName}
                  existingTicket={existingTicket}
                />
              )}
            </Card>
          );
        })}
      </div>
    </main>
  );
}
