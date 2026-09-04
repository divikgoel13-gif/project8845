"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createVendorGrievance } from "@/lib/actions/vendor/grievance";
import { Button } from "@/components/ui/button";

/**
 * Vendor "open a grievance" form (SRS Phase 6: "Vendor grievance creation
 * + messaging to Super Admin"). Categories are limited to the ones a vendor
 * can legitimately raise — the server action validates the same set.
 */
const CATEGORIES: { value: string; label: string }[] = [
  { value: "payment", label: "Payment / payout" },
  { value: "refund", label: "Refund" },
  { value: "vendor_issue", label: "Restaurant operations" },
  { value: "account", label: "Account / access" },
  { value: "technical", label: "Technical issue" },
  { value: "other", label: "Something else" },
];

export function NewGrievanceForm({
  restaurants,
}: {
  restaurants: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("payment");
  const [restaurantId, setRestaurantId] = useState<string>("");
  const [body, setBody] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        const { ticketId } = await createVendorGrievance({
          restaurantId: restaurantId || null,
          category: category as any,
          body: body.trim(),
        });
        setBody("");
        setOpen(false);
        router.push(`/vendor/grievances/${ticketId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not open your grievance.");
      }
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="text-sm">
        New grievance
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-brand border border-cream-300 bg-cream-50 p-4">
      <label className="text-sm font-medium text-ink">
        Category
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="mt-1 block w-full rounded-brand border border-cream-300 bg-cream-50 px-2 py-1.5 text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      {restaurants.length > 0 && (
        <label className="text-sm font-medium text-ink">
          Restaurant (optional)
          <select
            value={restaurantId}
            onChange={(e) => setRestaurantId(e.target.value)}
            className="mt-1 block w-full rounded-brand border border-cream-300 bg-cream-50 px-2 py-1.5 text-sm"
          >
            <option value="">Not restaurant-specific</option>
            {restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="text-sm font-medium text-ink">
        Describe your issue
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          required
          className="mt-1 block w-full rounded-brand border border-cream-300 bg-cream-50 px-2 py-1.5 text-sm"
          placeholder="Give UNI8 support the details they need to help."
        />
      </label>

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending} className="text-sm">
          {isPending ? "Sending…" : "Send to UNI8"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} className="text-sm">
          Cancel
        </Button>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
    </form>
  );
}
