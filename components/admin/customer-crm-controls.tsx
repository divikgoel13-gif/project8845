"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  addCustomerNote,
  addCustomerFlag,
  clearCustomerFlag,
  setCustomerAccountStatus,
} from "@/lib/actions/admin/customers";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, FormError, FormSuccess } from "@/components/ui/field";

/**
 * Customer 360 write controls (SRS §7.2 Admin Notes, §7.3 manual flags, §8
 * account suspension).
 *
 * Four small islands rather than one panel, because they sit in four different
 * sections of the page and each has a different consequence. Bundling them would
 * put a button that locks someone out of the platform next to a button that saves
 * an internal note.
 *
 * All four take ids as props and import only server actions — never the reader
 * module, which is `server-only`. Types that are needed here are declared locally
 * for the same reason.
 */

/**
 * Notes are append-only (§7.2 asks for "author/timestamp and audit trail"), so
 * this composer is the only control the notes section has: there is no edit and no
 * delete, and the absence is deliberate rather than unimplemented.
 */
export function AdminNoteComposer({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function submit() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await addCustomerNote({ customerId, body });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBody("");
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div>
      <Field
        label="Add an internal note"
        htmlFor={`note-${customerId}`}
        hint="Visible to super admins only. Saved against your name and cannot be edited or deleted afterwards."
      >
        <Textarea
          id={`note-${customerId}`}
          rows={3}
          value={body}
          maxLength={4000}
          placeholder="What happened, what was agreed, and anything the next person needs to know."
          onChange={(event) => setBody(event.currentTarget.value)}
        />
      </Field>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={submit} disabled={pending || body.trim().length < 3}>
          {pending ? "Saving…" : "Save note"}
        </Button>
        {saved ? <FormSuccess>Note saved.</FormSuccess> : null}
      </div>
      <FormError>{error}</FormError>
    </div>
  );
}

/**
 * Raise a manual flag. Both fields are required by the action's schema, and the
 * button stays disabled until both are filled, so the §7.3 requirement that a flag
 * be justified is enforced before a round trip rather than reported after one.
 *
 * `suggestions` is passed in by the page as a `datalist`, not an enum: a manual
 * flag exists precisely for the situation the derived flags cannot see, so the
 * common labels are offered without being the only options.
 */
export function AddCustomerFlagForm({
  customerId,
  suggestions,
}: {
  customerId: string;
  suggestions: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [flag, setFlag] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setOpen(false);
    setFlag("");
    setReason("");
    setError(null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await addCustomerFlag({ customerId, flag, reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      reset();
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Add a flag
      </Button>
    );
  }

  return (
    <div className="w-full max-w-xl">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Flag" htmlFor={`flag-${customerId}`} required hint="Short label shown as a badge">
          <Input
            id={`flag-${customerId}`}
            list={`flag-suggestions-${customerId}`}
            value={flag}
            maxLength={60}
            onChange={(event) => setFlag(event.currentTarget.value)}
          />
          <datalist id={`flag-suggestions-${customerId}`}>
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field
          label="Reason"
          htmlFor={`flag-reason-${customerId}`}
          required
          hint="The evidence. Shown next to the badge and recorded in the audit log."
        >
          <Input
            id={`flag-reason-${customerId}`}
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
        </Field>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={pending || flag.trim().length < 3 || reason.trim().length < 5}
        >
          {pending ? "Saving…" : "Raise flag"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={reset} disabled={pending}>
          Cancel
        </Button>
      </div>
      <FormError>{error}</FormError>
    </div>
  );
}

/**
 * Clear a flag. Expands to demand a reason instead of firing on click: the flag
 * row is kept and dated (§P), and "no longer applies" without a stated why leaves
 * the same gap in the record that deleting the row would.
 */
export function ClearFlagButton({ flagId, flag }: { flagId: string; flag: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await clearCustomerFlag({ flagId, reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Clear
      </Button>
    );
  }

  return (
    <div className="min-w-[16rem]">
      <Field
        label={`Why is “${flag}” no longer true?`}
        htmlFor={`clear-${flagId}`}
        required
        hint="The flag is kept and dated, not deleted."
      >
        <Input
          id={`clear-${flagId}`}
          value={reason}
          maxLength={500}
          onChange={(event) => setReason(event.currentTarget.value)}
        />
      </Field>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={submit} disabled={pending || reason.trim().length < 5}>
          {pending ? "Saving…" : "Clear flag"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setReason("");
            setError(null);
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

/**
 * Disable or re-enable the account (§7.2 Account & Security, §8).
 *
 * The heaviest control on the page, so it says what it does before it does it:
 * disabling stops sign-in but settles nothing — refunds owed, open tickets and
 * order history all survive, and the customer is still reachable here afterwards.
 * A reason is required in both directions, because "why was this account unlocked
 * again" is asked as often as why it was locked.
 */
export function CustomerAccountStatusControl({
  customerId,
  status,
}: {
  customerId: string;
  status: "active" | "disabled";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const next = status === "active" ? "disabled" : "active";
  const verb = status === "active" ? "Disable account" : "Re-enable account";

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await setCustomerAccountStatus({ customerId, status: next, reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant={status === "active" ? "danger" : "secondary"}
        onClick={() => setOpen(true)}
      >
        {verb}
      </Button>
    );
  }

  return (
    <div className="min-w-[18rem]">
      <Field
        label="Reason"
        htmlFor={`status-${customerId}`}
        required
        hint={
          status === "active"
            ? "Blocks sign-in immediately. Orders, refunds and open tickets are unaffected."
            : "Restores sign-in. The disable and this reversal both stay in the audit log."
        }
      >
        <Input
          id={`status-${customerId}`}
          value={reason}
          maxLength={500}
          onChange={(event) => setReason(event.currentTarget.value)}
        />
      </Field>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={status === "active" ? "danger" : "primary"}
          onClick={submit}
          disabled={pending || reason.trim().length < 5}
        >
          {pending ? "Saving…" : `Confirm — ${verb.toLowerCase()}`}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setReason("");
            setError(null);
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
