"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  postCustomerGrievanceMessage,
  reopenCustomerGrievance,
  submitGrievanceCsat,
} from "@/lib/actions/customer/grievance";
import {
  GrievanceAttachmentPicker,
  type PendingAttachment,
} from "@/components/grievance/attachment-picker";

/**
 * The customer's side of a support ticket (SRS V2 §I).
 *
 * §I: "Customers do not access the internal CRM." So this island offers exactly
 * three things a requester can legitimately do — reply, reopen, rate — and shows
 * nothing about how the ticket is being handled internally: no assignee, no SLA
 * clock, no priority control, no internal notes (those are stripped in Postgres
 * by `grievance_messages_select_scoped`, not hidden here).
 */

export function CustomerTicketReply({
  ticketId,
  closed,
  canAttach,
}: {
  ticketId: string;
  closed: boolean;
  /**
   * False once support has resolved the ticket. Migration 0018's Storage insert
   * policy refuses uploads on a resolved or closed ticket, so the picker has to
   * disappear at the same moment rather than fail on submit.
   */
  canAttach: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (closed) {
    return (
      <p className="text-sm text-ink-muted">
        This ticket is closed. Reopen it below if the problem is still there.
      </p>
    );
  }

  function send() {
    if (!body.trim()) {
      setError("Write a message first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await postCustomerGrievanceMessage({
          ticketId,
          body,
          attachmentPaths: attachments.length > 0 ? attachments.map((a) => a.path) : undefined,
        });
        setBody("");
        setAttachments([]);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not send your message.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Reply to UNI8 support"
        className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
      />
      {canAttach ? (
        <GrievanceAttachmentPicker
          ticketId={ticketId}
          value={attachments}
          onChange={setAttachments}
          disabled={isPending}
        />
      ) : null}
      {error && <p className="text-sm text-danger">{error}</p>}
      <div>
        <Button onClick={send} disabled={isPending}>
          {isPending ? "Sending..." : "Send"}
        </Button>
      </div>
    </div>
  );
}

export function CustomerTicketReopen({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (reason.trim().length < 5) {
      setError("Tell us what is still wrong.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await reopenCustomerGrievance({ ticketId, reason });
        setOpen(false);
        setReason("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not reopen this ticket.");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-semibold text-maroon-600 underline"
      >
        This isn&apos;t resolved — reopen it
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        maxLength={1000}
        placeholder="What is still wrong?"
        className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={submit} disabled={isPending}>
          {isPending ? "Reopening..." : "Reopen ticket"}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Optional post-resolution CSAT (§13). Rendered only for a resolved/closed
 * ticket that has no score yet; the action refuses a second submission, so a
 * stale page cannot overwrite an earlier answer.
 */
export function CustomerTicketCsat({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (done) return <p className="text-sm text-success">Thanks — that helps us.</p>;

  function submit() {
    if (score === 0) {
      setError("Pick a rating first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await submitGrievanceCsat({ ticketId, score, comment: comment.trim() || undefined });
        setDone(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save your rating.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">How was the support you got?</p>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setScore(n)}
            aria-label={`${n} out of 5`}
            className={`text-2xl leading-none ${n <= score ? "text-orange-500" : "text-cream-300"}`}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        maxLength={1000}
        placeholder="Anything you'd want us to do differently (optional)"
        className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div>
        <Button variant="secondary" onClick={submit} disabled={isPending}>
          {isPending ? "Saving..." : "Submit rating"}
        </Button>
      </div>
    </div>
  );
}
