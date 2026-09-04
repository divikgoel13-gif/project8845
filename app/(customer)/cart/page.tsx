import Link from "next/link";
import { getCurrentCartGrouped } from "@/lib/actions/customer/cart";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { QuantityStepper } from "@/components/customer/quantity-stepper";
import { paiseToRupeesDisplay } from "@/lib/money";

/**
 * Cart page (SRS §9: "Cart supports multiple restaurants. System
 * partitions cart into restaurant orders."). Each restaurant's items
 * render as its own group with its own subtotal — this grouping is what
 * checkout/schedule then sequences.
 */
export default async function CartPage() {
  const groups = await getCurrentCartGrouped();
  const hasAnyOrderableItems = groups.some((g) => g.orderable && g.items.some((i) => i.available));
  const grandTotal = groups.reduce((sum, g) => sum + g.subtotalPaise, 0);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-bold">Your cart</h1>

      {groups.length === 0 ? (
        <p className="mt-8 text-ink-soft">
          Your cart is empty.{" "}
          <Link href="/restaurants" className="font-medium text-orange-600 underline">
            Browse restaurants
          </Link>
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {groups.map((group) => (
            <Card key={group.restaurantId}>
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-bold">{group.restaurantName}</h2>
                {!group.orderable && (
                  <span className="rounded-full bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning">
                    Not accepting orders
                  </span>
                )}
              </div>
              <div className="mt-3 flex flex-col gap-3">
                {group.items.map((item) => (
                  <div key={item.cartItemId} className="flex items-center justify-between gap-3">
                    <div>
                      <p className={item.available ? "" : "text-ink-muted line-through"}>{item.name}</p>
                      <p className="text-sm text-ink-soft">{paiseToRupeesDisplay(item.pricePaise)}</p>
                      {!item.available && <p className="text-xs text-danger">No longer available</p>}
                    </div>
                    <QuantityStepper cartItemId={item.cartItemId} quantity={item.quantity} />
                  </div>
                ))}
              </div>
              <p className="mt-3 text-right text-sm font-medium">
                Subtotal: {paiseToRupeesDisplay(group.subtotalPaise)}
              </p>
            </Card>
          ))}

          <div className="flex items-center justify-between border-t border-cream-300 pt-4">
            <p className="text-lg font-bold">Total: {paiseToRupeesDisplay(grandTotal)}</p>
            <Link href="/checkout/schedule">
              <Button disabled={!hasAnyOrderableItems}>Schedule pickup</Button>
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
