"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setRestaurantStatus } from "@/lib/actions/admin/restaurants";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, FormError, FormSuccess } from "@/components/ui/field";
import { Badge, restaurantStatusTone } from "@/components/ui/badge";
import type { RestaurantStatus } from "@/lib/restaurants/status";

/**
 * Restaurant lifecycle controls (V2.6 §60 four states, SRS §5.3 Settings).
 *
 * A client island rather than four form posts because the reason field is
 * conditionally required and the pause deadline only exists for one of the four
 * targets — server-rendering that would mean a round trip to reveal an input the
 * operator already knows they need.
 *
 * The required-reason rule is mirrored here, not moved here: `setRestaurantStatus`
 * re-validates it. This copy exists so the operator learns about it before the
 * request, not so the server can trust the client.
 *
 * Archiving is separated below the others and asks for the restaurant's name.
 * It is the one transition with no ordinary path back in this UI, and §P means
 * the row survives — so the cost of an accidental archive is a support
 * conversation, not a delete.
 */

type Target = Exclude<RestaurantStatus, "archived">;

const TRANSITIONS: { status: Target; label: string; help: string }[] = [
  {
    status: "active",
    label: "Reactivate",
    help: "Accepts new orders immediately, subject to the pickup schedule.",
  },
  {
    status: "paused",
    label: "Pause",
    help: "Stops new orders. Orders already placed are unaffected and must still be fulfilled.",
  },
  {
    status: "closed",
    label: "Close",
    help: "Stops new orders indefinitely. Use for a vendor that has stopped trading.",
  },
];

export function RestaurantLifecycleControls({
  restaurantId,
  restaurantName,
  currentStatus,
}: {
  restaurantId: string;
  restaurantName: string;
  currentStatus: RestaurantStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<Target | null>(null);
  const [reason, setReason] = useState("");
  const [pausedUntil, setPausedUntil] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState("");
  const [archiveReason, setArchiveReason] = useState("");

  function reset() {
    setTarget(null);
    setReason("");
    setPausedUntil("");
    setError(null);
  }

  function apply(status: RestaurantStatus, statusReason: string, until?: string) {
    setError(null);
    setDone(null);
    startTransition(async () => {
      try {
        const result = await setRestaurantStatus({
          restaurantId,
          status,
          reason: statusReason || undefined,
          // A `datetime-local` value carries no zone. It is interpreted as the
          // operator's own clock — which on campus is the campus clock — and
          // converted to an instant here, because the column stores an instant.
          pausedUntil: status === "paused" && until ? new Date(until).toISOString() : undefined,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setDone(`Restaurant is now ${status}.`);
        reset();
        setArchiveConfirm("");
        setArchiveReason("");
        router.refresh();
      } catch {
        setError("Could not change the restaurant's state.");
      }
    });
  }

  function submitTransition(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target) return;
    if (target !== "active" && reason.trim().length === 0) {
      setError("A reason is required when pausing or closing a restaurant.");
      return;
    }
    apply(target, reason.trim(), pausedUntil);
  }

  function submitArchive(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (archiveConfirm.trim() !== restaurantName) {
      setError("Type the restaurant's name exactly to confirm archiving.");
      return;
    }
    if (archiveReason.trim().length === 0) {
      setError("A reason is required when archiving a restaurant.");
      return;
    }
    apply("archived", archiveReason.trim());
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Current state</span>
        <Badge tone={restaurantStatusTone(currentStatus)}>{currentStatus}</Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        {TRANSITIONS.filter((t) => t.status !== currentStatus).map((t) => (
          <Button
            key={t.status}
            type="button"
            size="sm"
            variant={t.status === "active" ? "primary" : "ghost"}
            onClick={() => {
              setTarget(t.status);
              setDone(null);
              setError(null);
            }}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {target && (
        <form onSubmit={submitTransition} className="flex flex-col gap-3 rounded-brand bg-cream-100 p-4">
          <p className="text-xs text-ink-soft">{TRANSITIONS.find((t) => t.status === target)?.help}</p>

          {target === "paused" && (
            <Field
              htmlFor="pausedUntil"
              label="Resume automatically at (optional)"
              hint="Leave empty to pause until someone reactivates it by hand."
            >
              <Input
                id="pausedUntil"
                type="datetime-local"
                value={pausedUntil}
                onChange={(e) => setPausedUntil(e.target.value)}
              />
            </Field>
          )}

          {target !== "active" && (
            <Field
              htmlFor="statusReason"
              label="Reason"
              hint="Shown to operators in the directory and recorded in the audit log."
            >
              <Textarea
                id="statusReason"
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={target === "paused" ? "Kitchen equipment failure" : "Vendor contract ended"}
              />
            </Field>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : `Confirm ${target === "active" ? "reactivation" : target}`}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={reset} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {currentStatus !== "archived" && (
        <form onSubmit={submitArchive} className="flex flex-col gap-3 border-t border-cream-300 pt-4">
          <div>
            <p className="font-display text-sm font-semibold text-ink">Archive</p>
            <p className="mt-0.5 text-xs text-ink-soft">
              Removes the restaurant from every operator list and from the customer app. Nothing is deleted — orders,
              payments and audit history remain readable in this workspace.
            </p>
          </div>

          <Field htmlFor="archiveReason" label="Reason">
            <Textarea
              id="archiveReason"
              rows={2}
              maxLength={500}
              value={archiveReason}
              onChange={(e) => setArchiveReason(e.target.value)}
            />
          </Field>

          <Field htmlFor="archiveConfirm" label={`Type “${restaurantName}” to confirm`}>
            <Input
              id="archiveConfirm"
              value={archiveConfirm}
              onChange={(e) => setArchiveConfirm(e.target.value)}
              autoComplete="off"
            />
          </Field>

          <div>
            <Button
              type="submit"
              size="sm"
              variant="danger"
              disabled={pending || archiveConfirm.trim() !== restaurantName}
            >
              {pending ? "Archiving…" : "Archive restaurant"}
            </Button>
          </div>
        </form>
      )}

      <FormError>{error}</FormError>
      <FormSuccess>{done}</FormSuccess>
    </div>
  );
}
