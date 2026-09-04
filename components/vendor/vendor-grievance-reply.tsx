"use client";

import { useState, useTransition } from "react";
import { postVendorGrievanceMessage } from "@/lib/actions/vendor/grievance";
import { Button } from "@/components/ui/button";

/**
 * Vendor-side reply box for an existing grievance thread. The server action
 * enforces ownership and that the ticket isn't closed; this just captures
 * the message.
 */
export function VendorGrievanceReply({ ticketId, closed }: { ticketId: string; closed: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");

  if (closed) {
    return (
      <p className="mt-4 text-sm text-ink-soft">
        This grievance is closed. Open a new one from the Grievances page if you still need help.
      </p>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        await postVendorGrievanceMessage({ ticketId, body: body.trim() });
        setBody("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not send your message.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        required
        placeholder="Reply to UNI8 support…"
        className="rounded-brand border border-cream-300 bg-cream-50 px-2 py-1.5 text-sm"
      />
      <div>
        <Button type="submit" disabled={isPending} className="text-sm">
          {isPending ? "Sending…" : "Send reply"}
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </form>
  );
}
