"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { triggerReconciliationScan, updateReconciliationItemStatus } from "@/lib/actions/admin/reconciliation";
import { fmtCount } from "@/lib/admin/format";
import { Button } from "@/components/ui/button";
import { Field, Input, FormError, FormSuccess } from "@/components/ui/field";

/** Runs the six-detector scan and upserts findings (SRS §T). A deliberate
 *  button, not an automatic on-load scan — see lib/admin/reconciliation.ts's
 *  header on why §T's "resolution is manual" extends to running the scan
 *  itself being an explicit Super Admin action, not a background job (this
 *  codebase has no job scheduler to run one on regardless). */
export function RunReconciliationScanButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    setSummary(null);
    startTransition(async () => {
      const result = await triggerReconciliationScan();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSummary(
        result.result.candidateCount === 0
          ? "Scan complete — no mismatches found."
          : `Scan complete — ${fmtCount(result.result.candidateCount)} finding${result.result.candidateCount === 1 ? "" : "s"} refreshed below.`
      );
      router.refresh();
    });
  }

  return (
    <div>
      <Button type="button" onClick={run} disabled={pending}>
        {pending ? "Scanning…" : "Run scan now"}
      </Button>
      {summary ? <FormSuccess>{summary}</FormSuccess> : null}
      <FormError>{error}</FormError>
    </div>
  );
}

export function ReconciliationItemControls({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"resolved" | "ignored" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function startInvestigating() {
    setError(null);
    startTransition(async () => {
      const result = await updateReconciliationItemStatus({ id, status: "investigating", note: null });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function submitTerminal() {
    if (!mode) return;
    setError(null);
    startTransition(async () => {
      const result = await updateReconciliationItemStatus({ id, status: mode, note: note.trim() || null });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (status === "resolved" || status === "ignored") {
    return <span className="text-xs text-ink-muted">{status === "resolved" ? "Resolved" : "Ignored"}</span>;
  }

  if (mode) {
    return (
      <div className="min-w-[16rem]">
        <Field
          label="Note"
          htmlFor={`recon-note-${id}`}
          required
          hint={mode === "resolved" ? "What was fixed and how, for the audit log" : "Why this is not a real mismatch"}
        >
          <Input id={`recon-note-${id}`} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        </Field>
        <div className="mt-2 flex gap-2">
          <Button type="button" size="sm" variant={mode === "ignored" ? "ghost" : "secondary"} onClick={submitTerminal} disabled={pending || note.trim().length === 0}>
            {pending ? "Saving…" : mode === "resolved" ? "Confirm resolved" : "Confirm ignore"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setMode(null);
              setNote("");
            }}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>
        <FormError>{error}</FormError>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "open" ? (
        <Button type="button" size="sm" variant="ghost" onClick={startInvestigating} disabled={pending}>
          {pending ? "Saving…" : "Start investigating"}
        </Button>
      ) : null}
      <Button type="button" size="sm" variant="secondary" onClick={() => setMode("resolved")} disabled={pending}>
        Mark resolved
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setMode("ignored")} disabled={pending}>
        Ignore
      </Button>
      <FormError>{error}</FormError>
    </div>
  );
}
