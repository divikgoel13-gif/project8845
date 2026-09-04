"use client";

import { useState, useTransition } from "react";
import { recordManualRefund } from "@/lib/actions/admin/refund";
import { Button } from "@/components/ui/button";

/**
 * Super Admin manual refund recorder (SRS §V Phase 6). Only rendered on
 * order-linked grievances. Records that a refund was issued out-of-band;
 * the server action writes the refund_events ledger + audit trail.
 */
export function RecordRefundForm({ ticketId }: { ticketId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || !note.trim()) return;
    setError(null);
    setOk(false);
    startTransition(async () => {
      try {
        await recordManualRefund({
          ticketId,
          amountRupees: Number(amount),
          razorpayRefundId: ref.trim() || undefined,
          note: note.trim(),
        });
        setOk(true);
        setAmount("");
        setRef("");
        setNote("");
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not record the refund.");
      }
    });
  }

  if (!open) {
    return (
      <div className="border-t border-cream-300 pt-4">
        <Button variant="ghost" onClick={() => setOpen(true)} className="text-sm">
          Record a refund
        </Button>
        {ok && <p className="mt-1 text-xs text-success">Refund recorded.</p>}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-t border-cream-300 pt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Record refund</p>
      <input
        type="number"
        step="0.01"
        min="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="Amount (₹)"
        required
        className="rounded-brand border border-cream-300 bg-cream-50 px-2 py-1.5 text-sm"
      />
      <input
        type="text"
        value={ref}
        onChange={(e) => setRef(e.target.value)}
        placeholder="Refund reference (optional)"
        className="rounded-brand border border-cream-300 bg-cream-50 px-2 py-1.5 text-sm"
      />
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        required
        placeholder="Note (why / how the refund was issued)"
        className="rounded-brand border border-cream-300 bg-cream-50 px-2 py-1.5 text-sm"
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={isPending} className="text-sm">
          {isPending ? "Recording…" : "Save refund"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} className="text-sm">
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </form>
  );
}
