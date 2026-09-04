"use client";

import { useState, useTransition } from "react";
import { markPayoutReceived, markPayoutNotReceived } from "@/lib/actions/vendor/acknowledge-payout";

/**
 * Vendor payout acknowledgement controls (SRS Phase 6: "Received / Not
 * Received acknowledgement," "Not-Received escalation to grievance CRM").
 * Only rendered for disbursements in the `paid` state — once acknowledged,
 * the parent shows the resulting status instead. The server action is the
 * real authority on whether an ack is still allowed.
 */
export function PayoutAckActions({
  restaurantId,
  disbursementId,
}: {
  restaurantId: string;
  disbursementId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showDispute, setShowDispute] = useState(false);
  const [note, setNote] = useState("");

  function received() {
    setError(null);
    startTransition(async () => {
      try {
        await markPayoutReceived({ restaurantId, disbursementId });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not acknowledge this payout.");
      }
    });
  }

  function dispute(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        await markPayoutNotReceived({ restaurantId, disbursementId, note: note.trim() });
        setShowDispute(false);
        setNote("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not report this payout.");
      }
    });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={received}
          disabled={isPending}
          className="rounded-full bg-success px-3 py-1 text-xs font-semibold text-cream-50 disabled:opacity-50"
        >
          Received
        </button>
        <button
          onClick={() => setShowDispute((v) => !v)}
          disabled={isPending}
          className="rounded-full bg-danger-bg px-3 py-1 text-xs font-semibold text-danger disabled:opacity-50"
        >
          Not received
        </button>
      </div>

      {showDispute && (
        <form onSubmit={dispute} className="mt-2 flex flex-col gap-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Tell UNI8 what's wrong — this opens a payment grievance to support."
            className="rounded-brand border border-cream-300 bg-cream-50 px-2 py-1 text-xs"
            rows={3}
            required
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-full bg-danger px-3 py-1 text-xs font-semibold text-cream-50 disabled:opacity-50"
            >
              Report to UNI8
            </button>
            <button
              type="button"
              onClick={() => setShowDispute(false)}
              className="rounded-full bg-cream-200 px-3 py-1 text-xs font-medium text-ink-soft"
            >
              Back
            </button>
          </div>
        </form>
      )}

      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
