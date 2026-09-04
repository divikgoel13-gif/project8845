"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { disburseToVendor } from "@/lib/actions/admin/disburse";
import { Button } from "@/components/ui/button";

/**
 * Super Admin manual disbursement form (SRS Phase 6: "enter amount → mark
 * disbursed + upload proof," partial + over-disburse override). Submits a
 * FormData (proof file). The server action re-validates everything —
 * over-disbursement without an audited override is rejected there, not
 * just hidden here.
 */
export function DisburseForm({
  restaurantId,
  outstandingRupees,
}: {
  restaurantId: string;
  outstandingRupees: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [override, setOverride] = useState(false);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setOk(false);
    const form = e.currentTarget;
    const formData = new FormData(form);
    formData.set("restaurantId", restaurantId);
    formData.set("override", override ? "true" : "false");

    startTransition(async () => {
      try {
        await disburseToVendor(formData);
        setOk(true);
        form.reset();
        setOverride(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not record the disbursement.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-xs text-ink-soft">Outstanding payable: {outstandingRupees}</p>

      <label className="text-sm font-medium text-ink">
        Amount (₹)
        <input
          name="amountRupees"
          type="number"
          step="0.01"
          min="0.01"
          required
          className="mt-1 block w-full rounded-brand border border-cream-300 bg-cream-50 px-2 py-1.5 text-sm"
        />
      </label>

      <label className="text-sm font-medium text-ink">
        Reference (UTR / txn id, optional)
        <input
          name="reference"
          type="text"
          maxLength={200}
          className="mt-1 block w-full rounded-brand border border-cream-300 bg-cream-50 px-2 py-1.5 text-sm"
        />
      </label>

      <label className="text-sm font-medium text-ink">
        Proof of payment (required)
        <input
          name="proof"
          type="file"
          accept="image/*,application/pdf"
          required
          className="mt-1 block w-full text-sm text-ink-soft"
        />
      </label>

      <label className="flex items-start gap-2 text-xs text-ink-soft">
        <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="mt-0.5" />
        <span>Override — allow disbursing more than the outstanding payable (requires a reason, audited).</span>
      </label>

      {override && (
        <label className="text-sm font-medium text-ink">
          Override reason
          <textarea
            name="overrideReason"
            rows={2}
            className="mt-1 block w-full rounded-brand border border-cream-300 bg-cream-50 px-2 py-1.5 text-sm"
            placeholder="Why is an over-payment justified?"
          />
        </label>
      )}

      <div>
        <Button type="submit" disabled={isPending} className="text-sm">
          {isPending ? "Recording…" : "Mark disbursed"}
        </Button>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
      {ok && <p className="text-xs text-success">Disbursement recorded.</p>}
    </form>
  );
}
