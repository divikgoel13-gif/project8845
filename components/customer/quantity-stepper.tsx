"use client";

import { useTransition } from "react";
import { updateCartItemQuantity } from "@/lib/actions/customer/cart";

export function QuantityStepper({ cartItemId, quantity }: { cartItemId: string; quantity: number }) {
  const [isPending, startTransition] = useTransition();

  function change(delta: number) {
    const next = quantity + delta;
    startTransition(() => updateCartItemQuantity({ cartItemId, quantity: Math.max(0, next) }));
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => change(-1)}
        disabled={isPending}
        aria-label="Decrease quantity"
        className="h-8 w-8 rounded-full border border-cream-300 text-lg leading-none disabled:opacity-50"
      >
        –
      </button>
      <span className="w-6 text-center">{quantity}</span>
      <button
        onClick={() => change(1)}
        disabled={isPending}
        aria-label="Increase quantity"
        className="h-8 w-8 rounded-full border border-cream-300 text-lg leading-none disabled:opacity-50"
      >
        +
      </button>
    </div>
  );
}
