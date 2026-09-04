"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateFraudFlagStatus } from "@/lib/actions/admin/fraud";
import { Button } from "@/components/ui/button";
import { Field, Input, FormError } from "@/components/ui/field";

/** SRS §S review actions for one open/investigating flag. Mirrors
 *  `AccessRowActions`' expand-to-reason shape (Phase 8B) — a row-level
 *  action with no note stays a plain button; choosing to resolve or dismiss
 *  reveals the note field a decision like that deserves. */
export function FraudFlagControls({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"resolved" | "dismissed" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function startInvestigating() {
    setError(null);
    startTransition(async () => {
      const result = await updateFraudFlagStatus({ id, status: "investigating", note: null });
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
      const result = await updateFraudFlagStatus({ id, status: mode, note: note.trim() || null });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (status === "resolved" || status === "dismissed") {
    return <span className="text-xs text-ink-muted">{status === "resolved" ? "Resolved" : "Dismissed"}</span>;
  }

  if (mode) {
    return (
      <div className="min-w-[16rem]">
        <Field label="Note" htmlFor={`fraud-note-${id}`} required hint="Recorded in the audit log">
          <Input id={`fraud-note-${id}`} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        </Field>
        <div className="mt-2 flex gap-2">
          <Button type="button" size="sm" variant={mode === "dismissed" ? "ghost" : "secondary"} onClick={submitTerminal} disabled={pending || note.trim().length === 0}>
            {pending ? "Saving…" : mode === "resolved" ? "Confirm resolve" : "Confirm dismiss"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setMode(null); setNote(""); }} disabled={pending}>
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
        Resolve
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setMode("dismissed")} disabled={pending}>
        Dismiss
      </Button>
      <FormError>{error}</FormError>
    </div>
  );
}
