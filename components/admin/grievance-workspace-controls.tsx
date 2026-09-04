"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea, Input, FormError } from "@/components/ui/field";
import {
  assignGrievance,
  createGrievanceTemplate,
  escalateGrievance,
  linkGrievanceRecords,
  postAdminGrievanceMessage,
  reopenGrievance,
  setGrievancePriority,
  setGrievanceStatus,
  setGrievanceTemplateActive,
} from "@/lib/actions/admin/grievance";
import type { GrievanceTemplate, SupportAgent } from "@/lib/admin/grievances";
import {
  GrievanceAttachmentPicker,
  type PendingAttachment,
} from "@/components/grievance/attachment-picker";

/**
 * The Super Admin's controls on one ticket (SRS §13).
 *
 * Split into small islands rather than one form, for a reason that matters in
 * practice: each of these is a separate audited operation with its own
 * validation, and one big form would let an agent change priority, assignee and
 * status in a single submit that produces one ambiguous timeline entry. Support
 * timelines are only useful if each entry corresponds to one decision.
 *
 * Everything here calls a Server Action; nothing imports a `server-only` reader.
 * Types come across with `import type`, which is erased at build time.
 */

/** §13 resolution categories. Free text would make resolution reasons uncountable. */
const RESOLUTION_CATEGORIES = [
  "refund_issued",
  "partial_refund",
  "replacement_arranged",
  "restaurant_corrected",
  "customer_error",
  "no_fault_found",
  "duplicate",
  "policy_explained",
  "other",
] as const;

function label(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/* ── Composer ───────────────────────────────────────────────────────────── */

export function GrievanceComposer({
  ticketId,
  templates,
  canAttach,
}: {
  ticketId: string;
  templates: GrievanceTemplate[];
  /** False on a resolved/closed ticket — the bucket policy would reject uploads. */
  canAttach: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [templateKey, setTemplateKey] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function applyTemplate(id: string) {
    setTemplateKey(id);
    const template = templates.find((t) => t.id === id);
    if (template) setBody(template.body);
  }

  function send() {
    if (!body.trim()) {
      setError("Write something first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await postAdminGrievanceMessage({
          ticketId,
          body,
          isInternal,
          templateKey: templateKey
            ? templates.find((t) => t.id === templateKey)?.name ?? undefined
            : undefined,
          attachmentPaths: attachments.length > 0 ? attachments.map((a) => a.path) : undefined,
        });
        setBody("");
        setTemplateKey("");
        setAttachments([]);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not post that.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setIsInternal(false)}
          aria-pressed={!isInternal}
          className={
            !isInternal
              ? "rounded-brand border border-maroon-500 bg-maroon-500 px-3 py-1.5 text-xs font-semibold text-cream-50"
              : "rounded-brand border border-cream-300 px-3 py-1.5 text-xs font-medium text-ink"
          }
        >
          Reply to requester
        </button>
        <button
          type="button"
          onClick={() => setIsInternal(true)}
          aria-pressed={isInternal}
          className={
            isInternal
              ? "rounded-brand border border-warning bg-warning-bg px-3 py-1.5 text-xs font-semibold text-warning"
              : "rounded-brand border border-cream-300 px-3 py-1.5 text-xs font-medium text-ink"
          }
        >
          Internal note
        </button>
      </div>

      {templates.length > 0 && !isInternal && (
        <Field label="Approved template" htmlFor="grievance-template">
          <Select id="grievance-template" value={templateKey} onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">Start from scratch</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.category ? ` · ${label(t.category)}` : ""}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        maxLength={4000}
        placeholder={
          isInternal
            ? "Only UNI8 support can see this. The requester never will."
            : "Your reply to the requester"
        }
      />

      {isInternal && (
        <p className="text-xs text-ink-muted">
          Internal notes are hidden from the requester by RLS, not by this screen, and never trigger
          a notification.
        </p>
      )}

      {canAttach ? (
        <GrievanceAttachmentPicker
          ticketId={ticketId}
          value={attachments}
          onChange={setAttachments}
          disabled={isPending}
        />
      ) : (
        <p className="text-xs text-ink-muted">
          This ticket is resolved, so new files cannot be attached. Reopen it to add evidence.
        </p>
      )}

      {error && <FormError>{error}</FormError>}

      <div>
        <Button onClick={send} disabled={isPending}>
          {isPending ? "Posting..." : isInternal ? "Add internal note" : "Send reply"}
        </Button>
      </div>
    </div>
  );
}

/* ── Assignment ─────────────────────────────────────────────────────────── */

export function GrievanceAssignment({
  ticketId,
  assigneeId,
  agents,
  viewerId,
}: {
  ticketId: string;
  assigneeId: string | null;
  agents: SupportAgent[];
  viewerId: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(assigneeId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save(next: string) {
    setError(null);
    startTransition(async () => {
      try {
        await assignGrievance({ ticketId, assigneeId: next ? next : null });
        setValue(next);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not reassign this ticket.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Field label="Assigned to" htmlFor="grievance-assignee" hint="Every change is kept as reassignment history.">
        <Select id="grievance-assignee" value={value} onChange={(e) => save(e.target.value)} disabled={isPending}>
          <option value="">Unassigned</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name ?? a.email ?? a.id.slice(0, 8)}
            </option>
          ))}
        </Select>
      </Field>
      {value !== viewerId && (
        <button
          type="button"
          onClick={() => save(viewerId)}
          disabled={isPending}
          className="self-start text-xs font-semibold text-maroon-600 underline"
        >
          Assign to me
        </button>
      )}
      {error && <FormError>{error}</FormError>}
    </div>
  );
}

/* ── Priority ───────────────────────────────────────────────────────────── */

export function GrievancePriorityControl({
  ticketId,
  priority,
}: {
  ticketId: string;
  priority: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(priority);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save(next: string) {
    setError(null);
    startTransition(async () => {
      try {
        await setGrievancePriority({ ticketId, priority: next as "low" | "normal" | "high" | "urgent" });
        setValue(next);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not change priority.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Field
        label="Priority"
        htmlFor="grievance-priority"
        hint="Changing this does not move the SLA — the ticket keeps the clock it was promised."
      >
        <Select id="grievance-priority" value={value} onChange={(e) => save(e.target.value)} disabled={isPending}>
          {["low", "normal", "high", "urgent"].map((p) => (
            <option key={p} value={p}>
              {label(p)}
            </option>
          ))}
        </Select>
      </Field>
      {error && <FormError>{error}</FormError>}
    </div>
  );
}

/* ── Status, resolution and closure ─────────────────────────────────────── */

const OPEN_STATUSES = ["open", "in_review", "waiting_customer", "waiting_vendor"] as const;

export function GrievanceStatusControl({
  ticketId,
  status,
  resolutionCategory,
}: {
  ticketId: string;
  status: string;
  resolutionCategory: string | null;
}) {
  const router = useRouter();
  const [next, setNext] = useState(status);
  const [note, setNote] = useState("");
  const [category, setCategory] = useState(resolutionCategory ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const resolving = next === "resolved" || next === "closed";

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await setGrievanceStatus({
          ticketId,
          status: next as
            | "open"
            | "in_review"
            | "waiting_customer"
            | "waiting_vendor"
            | "escalated"
            | "resolved"
            | "closed",
          resolutionNote: resolving ? note : undefined,
          resolutionCategory: resolving ? category : undefined,
        });
        setNote("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not change the status.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="Status" htmlFor="grievance-status">
        <Select id="grievance-status" value={next} onChange={(e) => setNext(e.target.value)}>
          {OPEN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </Select>
      </Field>

      {/*
        §13 and the Phase 8 completion standard both require a note to resolve or
        close, and a category so resolution reasons stay countable. Both fields
        appear only when they are required, so the common case (moving a ticket
        between working states) stays one control.
      */}
      {resolving && (
        <>
          <Field label="Resolution category" htmlFor="grievance-resolution-category" required>
            <Select
              id="grievance-resolution-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Choose one</option>
              {RESOLUTION_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {label(c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Resolution note"
            htmlFor="grievance-resolution-note"
            required
            hint="Kept on the ticket permanently and shown to the requester."
          >
            <Textarea
              id="grievance-resolution-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              maxLength={2000}
            />
          </Field>
        </>
      )}

      {error && <FormError>{error}</FormError>}

      <div>
        <Button onClick={save} disabled={isPending || next === status}>
          {isPending ? "Saving..." : resolving ? "Resolve ticket" : "Update status"}
        </Button>
      </div>
    </div>
  );
}

/* ── Escalation ─────────────────────────────────────────────────────────── */

export function GrievanceEscalate({
  ticketId,
  agents,
  escalated,
}: {
  ticketId: string;
  agents: SupportAgent[];
  escalated: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (reason.trim().length < 10) {
      setError("Escalation needs a reason — at least a sentence.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await escalateGrievance({
          ticketId,
          reason,
          assigneeId: assigneeId ? assigneeId : undefined,
        });
        setOpen(false);
        setReason("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not escalate this ticket.");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-sm font-semibold text-danger underline"
      >
        {escalated ? "Escalate again" : "Escalate to a senior admin"}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="Why does this need escalating?" htmlFor="grievance-escalation-reason" required>
        <Textarea
          id="grievance-escalation-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={1000}
        />
      </Field>
      <Field label="Hand to (optional)" htmlFor="grievance-escalation-assignee">
        <Select
          id="grievance-escalation-assignee"
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
        >
          <option value="">Leave the assignee as it is</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name ?? a.email ?? a.id.slice(0, 8)}
            </option>
          ))}
        </Select>
      </Field>
      {error && <FormError>{error}</FormError>}
      <div className="flex gap-2">
        <Button onClick={submit} disabled={isPending} variant="danger">
          {isPending ? "Escalating..." : "Escalate"}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ── Reopen ─────────────────────────────────────────────────────────────── */

export function GrievanceReopen({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (reason.trim().length < 5) {
      setError("Give a reason for reopening.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await reopenGrievance({ ticketId, reason });
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
        className="self-start text-sm font-semibold text-maroon-600 underline"
      >
        Reopen this ticket
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Why is it being reopened?"
        htmlFor="grievance-reopen-reason"
        required
        hint="The previous resolution and the whole timeline are kept."
      >
        <Textarea
          id="grievance-reopen-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={1000}
        />
      </Field>
      {error && <FormError>{error}</FormError>}
      <div className="flex gap-2">
        <Button onClick={submit} disabled={isPending}>
          {isPending ? "Reopening..." : "Reopen"}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ── Linked records ─────────────────────────────────────────────────────── */

export function GrievanceLinkOrder({
  ticketId,
  orderId,
}: {
  ticketId: string;
  orderId: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(orderId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        await linkGrievanceRecords({
          ticketId,
          orderId: value.trim() ? value.trim() : null,
          restaurantId: null, // derived from the order server-side
        });
        setSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not link that order.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Field
        label="Linked order"
        htmlFor="grievance-link-order"
        hint="The restaurant is taken from the order, so a mismatched pair can't be saved."
      >
        <Input
          id="grievance-link-order"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Order id"
        />
      </Field>
      {error && <FormError>{error}</FormError>}
      {saved && <p className="text-xs text-success">Linked.</p>}
      <div>
        <Button variant="secondary" onClick={submit} disabled={isPending}>
          {isPending ? "Linking..." : "Save link"}
        </Button>
      </div>
    </div>
  );
}

/* ── Approved response templates ────────────────────────────────────────── */

/**
 * §13 "approved response templates". Managed from the queue page rather than
 * from inside a ticket: a template is platform copy, not part of any one
 * complaint, and editing it while looking at a single ticket invites wording
 * that only makes sense for that ticket.
 *
 * Retiring rather than deleting is the deliberate part. A retired template is
 * still the wording that was sent to real requesters while it was live, so the
 * row stays and simply stops appearing in the composer.
 */
const TEMPLATE_CATEGORIES = [
  "payment",
  "refund",
  "wrong_item",
  "missing_item",
  "pickup",
  "qr",
  "vendor_issue",
  "staff_issue",
  "product_issue",
  "account",
  "technical",
  "other",
] as const;

type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export function GrievanceTemplateManager({ templates }: { templates: GrievanceTemplate[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function create() {
    setError(null);
    startTransition(async () => {
      try {
        await createGrievanceTemplate({
          name,
          category: category ? (category as TemplateCategory) : null,
          body,
        });
        setName("");
        setCategory("");
        setBody("");
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save that template.");
      }
    });
  }

  function toggle(templateId: string, isActive: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        await setGrievanceTemplateActive({ templateId, isActive });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not change that template.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {templates.length === 0 ? (
        <p className="text-xs text-ink-muted">
          No templates yet. Agents can still write every reply by hand — templates only make the common answers
          consistent.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-cream-200">
          {templates.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">
                  {t.name}
                  {t.category ? (
                    <span className="ml-2 text-xs text-ink-muted">{label(t.category)}</span>
                  ) : null}
                  {!t.isActive ? <span className="ml-2 text-xs text-warning">Retired</span> : null}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-ink-soft">{t.body}</p>
              </div>
              <button
                type="button"
                onClick={() => toggle(t.id, !t.isActive)}
                disabled={isPending}
                className="shrink-0 text-xs font-semibold text-maroon-600 underline"
              >
                {t.isActive ? "Retire" : "Restore"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <FormError>{error}</FormError>}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="self-start text-sm font-semibold text-maroon-600 underline"
        >
          Add a template
        </button>
      ) : (
        <div className="flex flex-col gap-3 border-t border-cream-200 pt-3">
          <Field label="Name" htmlFor="template-name" required hint="Names are unique, ignoring case.">
            <Input
              id="template-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="Refund approved"
            />
          </Field>
          <Field
            label="Category"
            htmlFor="template-category"
            hint="Leave blank to offer it on every ticket."
          >
            <Select
              id="template-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Any category</option>
              {TEMPLATE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {label(c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Copy" htmlFor="template-body" required>
            <Textarea
              id="template-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              maxLength={4000}
            />
          </Field>
          <div className="flex gap-2">
            <Button onClick={create} disabled={isPending}>
              {isPending ? "Saving..." : "Save template"}
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}


