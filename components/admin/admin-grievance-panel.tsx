"use client";

import { useState, useTransition } from "react";
import { postAdminGrievanceMessage, setGrievanceStatus } from "@/lib/actions/admin/grievance";
import { Button } from "@/components/ui/button";

/**
 * Super Admin grievance action panel (SRS Phase 6 + §13): reply to the
 * requester, add an internal note (invisible to them via RLS), or change
 * status / resolve. The server actions are the authority on what's allowed.
 */
const STATUSES = ["open", "in_review", "waiting_customer", "waiting_vendor", "escalated", "resolved", "closed"];

export function AdminGrievancePanel({ ticketId, currentStatus }: { ticketId: string; currentStatus: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [status, setStatus] = useState(currentStatus);
  const [resolutionNote, setResolutionNote] = useState("");

  const resolving = status === "resolved" || status === "closed";

  function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        await postAdminGrievanceMessage({ ticketId, body: body.trim(), isInternal });
        setBody("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not send the message.");
      }
    });
  }

  function applyStatus(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await setGrievanceStatus({
          ticketId,
          status: status as any,
          resolutionNote: resolving ? resolutionNote.trim() : undefined,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update the status.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={sendMessage} className="flex flex-col gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          required
          placeholder={isInternal ? "Internal note (only UNI8 sees this)…" : "Reply to the requester…"}
          className="rounded-brand border border-cream-300 bg-cream-50 px-2 py-1.5 text-sm"
        />
        <label className="flex items-center gap-2 text-xs text-ink-soft">
          <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} />
          Internal note (hidden from requester)
        </label>
        <div>
          <Button type="submit" disabled={isPending} className="text-sm">
            {isInternal ? "Add note" : "Send reply"}
          </Button>
        </div>
      </form>

      <form onSubmit={applyStatus} className="flex flex-col gap-2 border-t border-cream-300 pt-4">
        <label className="text-sm font-medium text-ink">
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="mt-1 block w-full rounded-brand border border-cream-300 bg-cream-50 px-2 py-1.5 text-sm capitalize"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        {resolving && (
          <textarea
            value={resolutionNote}
            onChange={(e) => setResolutionNote(e.target.value)}
            rows={2}
            required
            placeholder="Resolution note (required to resolve/close)"
            className="rounded-brand border border-cream-300 bg-cream-50 px-2 py-1.5 text-sm"
          />
        )}
        <div>
          <Button type="submit" variant="secondary" disabled={isPending} className="text-sm">
            Update status
          </Button>
        </div>
      </form>

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
