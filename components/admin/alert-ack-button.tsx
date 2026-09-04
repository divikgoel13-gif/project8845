"use client";

import { useState, useTransition } from "react";
import { acknowledgeAlert, clearAlertAcknowledgement } from "@/lib/actions/admin/live-ops";

/**
 * Acknowledge / un-acknowledge one operational alert (SRS V2 §F.1).
 *
 * A client island rather than a plain form because of what an acknowledgement
 * is FOR: it is a hand-off signal between operators during a rush, and a full
 * page navigation on a command center that lists a hundred alerts loses the
 * operator's scroll position every time they claim one. The optimistic flip plus
 * `useTransition` keeps the list still.
 *
 * The optional note is collapsed behind the button rather than always visible.
 * §F.1 only requires the ack be auditable; forcing a note before an operator can
 * claim an alert during a rush is how a team learns to acknowledge nothing.
 *
 * Failure is surfaced inline and the state rolls back. Silently swallowing a
 * failed ack would be the worst outcome here — two operators would each believe
 * the other had claimed the alert.
 */
export function AlertAckButton({
  alertType,
  targetTable,
  targetId,
  restaurantId,
  acknowledged,
  ackLabel,
}: {
  alertType: string;
  targetTable: string;
  targetId: string;
  restaurantId: string | null;
  acknowledged: boolean;
  /** e.g. "Acked by Priya, 12m ago" — rendered by the server, shown when acked. */
  ackLabel: string | null;
}) {
  const [isAcked, setIsAcked] = useState(acknowledged);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(next: boolean) {
    const previous = isAcked;
    setIsAcked(next);
    setError(null);
    startTransition(async () => {
      try {
        if (next) {
          await acknowledgeAlert({
            alertType: alertType as Parameters<typeof acknowledgeAlert>[0]["alertType"],
            targetTable,
            targetId,
            restaurantId,
            note: note.trim() ? note.trim() : undefined,
          });
          setShowNote(false);
          setNote("");
        } else {
          await clearAlertAcknowledgement({
            alertType: alertType as Parameters<typeof clearAlertAcknowledgement>[0]["alertType"],
            targetId,
          });
        }
      } catch (caught) {
        setIsAcked(previous);
        setError(caught instanceof Error ? caught.message : "Could not save. Try again.");
      }
    });
  }

  if (isAcked) {
    return (
      <div className="text-right">
        <p className="text-xs text-ink-muted">{ackLabel ?? "Acknowledged"}</p>
        <button
          type="button"
          onClick={() => run(false)}
          disabled={pending}
          className="mt-0.5 text-xs font-semibold text-maroon-600 underline disabled:opacity-50"
        >
          {pending ? "Saving" : "Undo"}
        </button>
        {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="text-right">
      {showNote ? (
        <div className="mb-1 flex items-center gap-1">
          <input
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional note"
            maxLength={1000}
            aria-label="Acknowledgement note"
            className="w-40 rounded-brand border border-cream-300 bg-cream-50 px-2 py-1 text-xs text-ink"
          />
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        {!showNote ? (
          <button
            type="button"
            onClick={() => setShowNote(true)}
            className="text-xs text-ink-muted underline hover:text-ink"
          >
            Add note
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => run(true)}
          disabled={pending}
          className="rounded-brand border border-cream-300 bg-cream-50 px-2.5 py-1 text-xs font-semibold text-ink hover:bg-cream-200 disabled:opacity-50"
        >
          {pending ? "Saving" : "Acknowledge"}
        </button>
      </div>
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
    </div>
  );
}
