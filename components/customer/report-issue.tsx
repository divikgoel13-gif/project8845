"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createOrderIssueTicket } from "@/lib/actions/customer/grievance";

/**
 * Customer order-issue shortcut (SRS V2 §I) and the "food not ready yet"
 * prompt (V2.6 §59).
 *
 * Both are the same action with different framing, so they are one component
 * with two modes rather than two components that drift apart.
 *
 * What the customer is NOT asked for is the point of §I: no order id, no
 * restaurant, no category field, no ticket type. They pick from this list and
 * the server derives everything else from the order they were already looking
 * at. `orderId` here is not user input — it comes from the page, which got it
 * from a query already scoped to this customer, and the action re-checks
 * ownership anyway.
 */

/** The §I list, in the SRS's order. Values match the action's issue map. */
const ISSUES = [
  { value: "wrong_item", label: "Wrong item" },
  { value: "missing_item", label: "Missing item" },
  { value: "food_issue", label: "Food / order issue" },
  { value: "pickup_issue", label: "Pickup issue" },
  { value: "qr_problem", label: "QR problem" },
  { value: "payment_issue", label: "Payment / refund issue" },
  { value: "restaurant_issue", label: "Restaurant issue" },
  { value: "other", label: "Other" },
] as const;

type IssueValue = (typeof ISSUES)[number]["value"];

export type ExistingTicket = { id: string; ticketNo: number | null; status: string };

export function ReportIssue({
  orderId,
  restaurantName,
  existingTicket,
}: {
  orderId: string;
  restaurantName: string;
  existingTicket?: ExistingTicket | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [issue, setIssue] = useState<IssueValue | "">("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Already has a live ticket on this order: point at it instead of offering to
  // open a second one. This is the same duplicate rule the action enforces —
  // shown here so the customer is not surprised by it after typing.
  if (existingTicket) {
    return (
      <div className="mt-3 border-t border-cream-300 pt-3">
        <p className="text-sm text-ink-soft">
          You have an open support ticket
          {existingTicket.ticketNo ? ` (#${existingTicket.ticketNo})` : ""} for this order.{" "}
          <Link href={`/support/${existingTicket.id}`} className="font-semibold text-maroon-600 underline">
            View the conversation
          </Link>
        </p>
      </div>
    );
  }

  function submit() {
    if (!issue) {
      setError("Choose what went wrong.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await createOrderIssueTicket({
          orderId,
          issue,
          body: body.trim() || undefined,
        });
        router.push(`/support/${result.ticketId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not raise your ticket.");
      }
    });
  }

  if (!open) {
    return (
      <div className="mt-3 border-t border-cream-300 pt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm font-semibold text-maroon-600 underline"
        >
          Need help with this order?
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-cream-300 pt-3">
      <div>
        <p className="text-sm font-semibold">Report an issue</p>
        <p className="text-xs text-ink-muted">
          This goes to UNI8 support. We already know it is your order at {restaurantName} — you
          don&apos;t need to look anything up. You can add a photo once the ticket opens.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {ISSUES.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setIssue(option.value)}
            aria-pressed={issue === option.value}
            className={
              issue === option.value
                ? "rounded-brand border border-maroon-500 bg-maroon-500 px-3 py-1.5 text-xs font-semibold text-cream-50"
                : "rounded-brand border border-cream-300 bg-cream-50 px-3 py-1.5 text-xs font-medium text-ink hover:border-maroon-500"
            }
          >
            {option.label}
          </button>
        ))}
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Anything else that would help us sort it out (optional)"
        className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
      />

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button onClick={submit} disabled={isPending}>
          {isPending ? "Raising ticket..." : "Raise a ticket"}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * V2.6 §59 prompt. Shown by the order page only when the order is
 * `ready_for_pickup`, uncollected, and ready for more than the threshold.
 *
 * Three §59 constraints are visible in the copy and structure:
 *  - it never says the restaurant is at fault — it states the elapsed time,
 *    which is a fact, and leaves attribution to support;
 *  - one tap raises the ticket, because the customer is standing at a counter,
 *    and the order/restaurant/customer are all auto-linked server-side;
 *  - the secondary action is a way out that isn't a ticket, so the prompt is not
 *    a dead end for someone who has simply not walked over yet.
 */
export function NotReadyPrompt({
  orderId,
  restaurantName,
  minutesWaiting,
  existingTicket,
}: {
  orderId: string;
  restaurantName: string;
  minutesWaiting: number;
  existingTicket?: ExistingTicket | null;
}) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (existingTicket) {
    return (
      <div className="mt-3 rounded-brand border border-info bg-info-bg px-3 py-2">
        <p className="text-sm text-info">
          We are on it — ticket
          {existingTicket.ticketNo ? ` #${existingTicket.ticketNo}` : ""} is open with UNI8 support.{" "}
          <Link href={`/support/${existingTicket.id}`} className="font-semibold underline">
            Follow it here
          </Link>
        </p>
      </div>
    );
  }

  if (dismissed) return null;

  function raise() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await createOrderIssueTicket({ orderId, issue: "not_ready" });
        router.push(`/support/${result.ticketId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not raise your ticket.");
      }
    });
  }

  return (
    <div className="mt-3 rounded-brand border border-warning bg-warning-bg px-3 py-3">
      <p className="text-sm font-semibold text-warning">Still waiting for this order?</p>
      <p className="mt-1 text-xs text-ink-soft">
        Your order at {restaurantName} has been marked ready for {minutesWaiting} minutes and has not
        been collected yet. If it isn&apos;t in your hands, tell UNI8 support and we will chase it —
        you don&apos;t need any order details.
      </p>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button onClick={raise} disabled={isPending}>
          {isPending ? "Raising ticket..." : "Raise a ticket"}
        </Button>
        <Button variant="secondary" onClick={() => setDismissed(true)} disabled={isPending}>
          I&apos;ve got it / not yet
        </Button>
      </div>
    </div>
  );
}
