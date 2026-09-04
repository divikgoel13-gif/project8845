"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setProductVisibility, setCategoryVisibility, reorderCatalog } from "@/lib/actions/admin/restaurant-catalog";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";

/**
 * Catalog visibility and ordering islands (V2.6 §60).
 *
 * Two small components rather than one table-wide client component: the rows
 * themselves are server-rendered, and only the two controls need interactivity.
 * Making the whole table a client component would ship every product name and
 * price as serialised props for no gain.
 *
 * Reordering is deliberately move-up / move-down rather than drag-and-drop. Drag
 * ordering on a phone (§27 makes phone support mandatory) collides with page
 * scrolling, and it needs a drag library the project does not have. Buttons also
 * work with a keyboard without extra ARIA machinery.
 */

export function VisibilityToggle({
  restaurantId,
  kind,
  id,
  isVisible,
}: {
  restaurantId: string;
  kind: "product" | "category";
  id: string;
  isVisible: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    startTransition(async () => {
      const result =
        kind === "product"
          ? await setProductVisibility({ restaurantId, productId: id, isVisible: !isVisible })
          : await setCategoryVisibility({ restaurantId, categoryId: id, isVisible: !isVisible });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <Button
        type="button"
        size="sm"
        variant={isVisible ? "ghost" : "primary"}
        onClick={toggle}
        disabled={pending}
        aria-label={isVisible ? `Hide ${kind}` : `Show ${kind}`}
      >
        {pending ? "…" : isVisible ? "Hide" : "Show"}
      </Button>
      <FormError>{error}</FormError>
    </div>
  );
}

/**
 * Moves one row and submits the WHOLE resulting order. `reorderCatalog` writes an
 * explicit `sort_order` for every id it is given, which is the only reliable way
 * to reorder a set whose legacy rows all share `sort_order = 0`.
 *
 * `ids` is the full ordered list as currently displayed, so the server never has
 * to guess what "up" meant relative to rows the page had filtered out.
 */
export function ReorderControls({
  restaurantId,
  kind,
  ids,
  index,
}: {
  restaurantId: string;
  kind: "product" | "category";
  ids: string[];
  index: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function move(delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    const next = [...ids];
    // Bounds are checked above (target is 0..ids.length-1) and index is a
    // valid position in the same array by contract, so both reads are safe.
    const a = next[index]!;
    const b = next[target]!;
    next[index] = b;
    next[target] = a;

    setError(null);
    startTransition(async () => {
      const result = await reorderCatalog({ restaurantId, kind, ids: next });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => move(-1)}
        disabled={pending || index === 0}
        aria-label="Move up"
      >
        Up
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => move(1)}
        disabled={pending || index === ids.length - 1}
        aria-label="Move down"
      >
        Down
      </Button>
      <FormError>{error}</FormError>
    </div>
  );
}
