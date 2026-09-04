"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { confirmPickupSchedule } from "@/lib/actions/customer/schedule";
import { campusIsoDate, campusTimeOfDay } from "@/lib/scheduling/timezone";

type StepState = {
  restaurantId: string;
  restaurantName: string;
  mode: "fixed_time" | "immediately_after";
  isoDate: string;
  time: string;
};

function defaultDateTime() {
  // Default to ~20 minutes from now, in CAMPUS-LOCAL time (not the
  // browser's UTC slice — a raw toISOString() slice would show the wrong
  // wall-clock value to anyone browsing outside IST, or even within it
  // depending on how the runtime formats). This is only a starting
  // suggestion in the picker; the server independently validates whatever
  // the customer actually submits (see lib/scheduling/feasibility.ts).
  const d = new Date(Date.now() + 20 * 60_000);
  return { isoDate: campusIsoDate(d), time: campusTimeOfDay(d).slice(0, 5) };
}

export function ScheduleForm({
  restaurants,
}: {
  restaurants: { restaurantId: string; restaurantName: string }[];
}) {
  const router = useRouter();
  const [steps, setSteps] = useState<StepState[]>(() =>
    restaurants.map((r, i) => ({
      restaurantId: r.restaurantId,
      restaurantName: r.restaurantName,
      mode: "fixed_time",
      ...defaultDateTime(),
    }))
  );
  const [error, setError] = useState<string | null>(null);
  const [failedRestaurantId, setFailedRestaurantId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    setSteps((prev) => {
      const next = [...prev];
      // Bounds are checked above (target is 0..steps.length-1) and index is
      // always a valid position in the same array, so both reads are safe.
      const a = next[index]!;
      const b = next[target]!;
      next[index] = b;
      next[target] = a;
      // The first restaurant in sequence must always be a fixed time —
      // reflect that immediately if reordering moved something into slot 0.
      if (target === 0) next[0] = { ...a, mode: "fixed_time" };
      return next;
    });
  }

  function updateStep(index: number, patch: Partial<StepState>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function handleSubmit() {
    setError(null);
    setFailedRestaurantId(null);

    startTransition(async () => {
      const result = await confirmPickupSchedule({
        sequence: steps.map((s) =>
          s.mode === "fixed_time"
            ? { restaurantId: s.restaurantId, mode: "fixed_time", isoDate: s.isoDate, time: s.time }
            : { restaurantId: s.restaurantId, mode: "immediately_after" }
        ),
      });

      if (!result.ok) {
        setError(result.error);
        setFailedRestaurantId(result.failedRestaurantId ?? null);
        return;
      }

      router.push(`/checkout?group=${result.groupId}`);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {steps.map((step, index) => (
        <Card
          key={step.restaurantId}
          className={failedRestaurantId === step.restaurantId ? "border-danger" : undefined}
        >
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">
              {index + 1}. {step.restaurantName}
            </h3>
            {steps.length > 1 && (
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  className="rounded-brand border border-cream-300 px-2 py-1 text-xs disabled:opacity-30"
                  aria-label="Move earlier"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === steps.length - 1}
                  className="rounded-brand border border-cream-300 px-2 py-1 text-xs disabled:opacity-30"
                  aria-label="Move later"
                >
                  ↓
                </button>
              </div>
            )}
          </div>

          {index > 0 && (
            <div className="mt-3 flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`mode-${step.restaurantId}`}
                  checked={step.mode === "fixed_time"}
                  onChange={() => updateStep(index, { mode: "fixed_time" })}
                />
                Choose a time
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`mode-${step.restaurantId}`}
                  checked={step.mode === "immediately_after"}
                  onChange={() => updateStep(index, { mode: "immediately_after" })}
                />
                Immediately after previous pickup
              </label>
            </div>
          )}

          {step.mode === "fixed_time" && (
            <div className="mt-3 flex gap-3">
              <input
                type="date"
                value={step.isoDate}
                onChange={(e) => updateStep(index, { isoDate: e.target.value })}
                className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
              />
              <input
                type="time"
                value={step.time}
                onChange={(e) => updateStep(index, { time: e.target.value })}
                className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
              />
            </div>
          )}
        </Card>
      ))}

      {error && <p className="text-sm text-danger">{error}</p>}

      <Button onClick={handleSubmit} disabled={isPending}>
        {isPending ? "Checking availability..." : "Continue to checkout"}
      </Button>
    </div>
  );
}
