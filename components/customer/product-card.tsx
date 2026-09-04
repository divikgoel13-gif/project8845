"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { paiseToRupeesDisplay } from "@/lib/money";
import { addToCart } from "@/lib/actions/customer/cart";
import type { ProductListItem } from "@/lib/data/products";

export function ProductCard({ product, orderable }: { product: ProductListItem; orderable: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const outOfStock = product.availability === "out_of_stock";

  function handleAdd() {
    setError(null);
    startTransition(async () => {
      try {
        await addToCart({ productId: product.id, quantity: 1 });
        setAdded(true);
        setTimeout(() => setAdded(false), 1500);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not add to cart.");
      }
    });
  }

  return (
    <Card className="flex items-center justify-between gap-4">
      <div>
        <h4 className="font-semibold">{product.name}</h4>
        {product.description && <p className="text-sm text-ink-soft">{product.description}</p>}
        <p className="mt-1 text-sm font-medium text-maroon-500">{paiseToRupeesDisplay(product.price_paise)}</p>
        {product.cook_time_minutes && (
          <p className="text-xs text-ink-muted">~{product.cook_time_minutes} min</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        {outOfStock ? (
          <span className="text-xs font-medium text-ink-muted">Out of stock</span>
        ) : (
          <Button onClick={handleAdd} disabled={isPending || !orderable} variant={added ? "secondary" : "primary"}>
            {added ? "Added" : "Add"}
          </Button>
        )}
        {error && <p className="max-w-[10rem] text-right text-xs text-danger">{error}</p>}
      </div>
    </Card>
  );
}
