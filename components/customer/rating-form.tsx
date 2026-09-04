"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { submitRating } from "@/lib/actions/customer/rating";

export function RatingForm({ orderId, restaurantId }: { orderId: string; restaurantId: string }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (submitted) {
    return <p className="text-sm text-success">Thanks for rating your order!</p>;
  }

  function handleSubmit() {
    if (stars === 0) {
      setError("Please select a star rating.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await submitRating({ orderId, restaurantId, stars, comment: comment || undefined });
        setSubmitted(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not submit rating.");
      }
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-cream-300 pt-3">
      <p className="text-sm font-medium">Rate this order</p>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setStars(n)}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            className={`text-2xl leading-none ${n <= stars ? "text-orange-500" : "text-cream-300"}`}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional comment"
        rows={2}
        className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button onClick={handleSubmit} disabled={isPending} variant="secondary">
        {isPending ? "Submitting..." : "Submit rating"}
      </Button>
    </div>
  );
}
