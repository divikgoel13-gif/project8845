import Link from "next/link";
import { getCheckoutPreview } from "@/lib/actions/customer/checkout-preview";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PickupCountdown } from "@/components/customer/pickup-countdown";
import { RazorpayCheckoutButton } from "@/components/customer/razorpay-checkout-button";
import { paiseToRupeesDisplay } from "@/lib/money";

/**
 * Checkout summary / order preview (SRS Phase 2/3). Every render re-runs
 * getCheckoutPreview, which re-validates restaurant status, product
 * availability/price, and pickup feasibility fresh — this page never
 * trusts a snapshot computed during scheduling (SRS V2 §L). "Continue to
 * payment" opens a real Razorpay Checkout session
 * (components/customer/razorpay-checkout-button.tsx); the `payment_pending`
 * order rows themselves are created server-side at that point (SRS §14),
 * not by this page.
 */
export default async function CheckoutPage({ searchParams }: { searchParams: { group?: string } }) {
  if (!searchParams.group) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-10">
        <p className="text-ink-soft">
          No checkout session found.{" "}
          <Link href="/cart" className="font-medium text-orange-600 underline">
            Back to cart
          </Link>
        </p>
      </main>
    );
  }

  const preview = await getCheckoutPreview(searchParams.group);

  if (!preview.valid) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-bold">Something changed</h1>
        <div className="mt-4 flex flex-col gap-2">
          {preview.issues.map((issue, i) => (
            <p key={i} className="rounded-brand bg-danger-bg px-4 py-3 text-sm text-danger">
              {issue}
            </p>
          ))}
        </div>
        <div className="mt-6 flex gap-3">
          <Link href="/cart">
            <Button variant="secondary">Review cart</Button>
          </Link>
          <Link href="/checkout/schedule">
            <Button variant="ghost">Reschedule</Button>
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-bold">Review your order</h1>

      <div className="mt-6 flex flex-col gap-4">
        {preview.restaurants.map((r) => (
          <Card key={r.restaurantId}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">
                {r.sequenceNo}. {r.restaurantName}
              </h2>
              <PickupCountdown pickupTimeIso={r.pickupTime} />
            </div>
            <p className="text-xs text-ink-muted">
              Pickup at{" "}
              {new Date(r.pickupTime).toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
            <div className="mt-3 flex flex-col gap-1 text-sm">
              {r.items.map((item, i) => (
                <div key={i} className="flex justify-between">
                  <span>
                    {item.quantity} × {item.name}
                  </span>
                  <span>{paiseToRupeesDisplay(item.pricePaise * item.quantity)}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-right text-sm font-medium">
              Subtotal: {paiseToRupeesDisplay(r.subtotalPaise)}
            </p>
          </Card>
        ))}

        <div className="flex items-center justify-between border-t border-cream-300 pt-4">
          <p className="text-lg font-bold">Total: {paiseToRupeesDisplay(preview.grandTotalPaise)}</p>
        </div>

        <RazorpayCheckoutButton groupId={preview.groupId} />
      </div>
    </main>
  );
}
