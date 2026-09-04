"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  createAnnouncement,
  updateAnnouncement,
  setAnnouncementPublishedState,
  archiveAnnouncement,
} from "@/lib/actions/admin/announcements";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Textarea, Select, FormError } from "@/components/ui/field";

/**
 * Announcement authoring and lifecycle controls (SRS V2 §O). One form
 * handles both create and edit — a new announcement is always a draft
 * (`is_published: false`, enforced in `createAnnouncement`), so this form
 * never itself publishes; publishing is `AnnouncementLifecycleButtons`
 * below, kept separate so §O's five audited verbs
 * (create/edit/publish/unpublish/archive) map onto genuinely distinct
 * actions rather than one form silently doing two things on submit.
 */

/** `datetime-local` inputs report the operator's LOCAL browser time with no
 *  timezone info. Converting through `Date` here, once, is what lets the
 *  server action require a real ISO instant (`z.string().datetime()`)
 *  instead of trusting an ambiguous local string. */
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isoToLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  // toISOString is UTC; slicing to minutes and dropping the offset gives the
  // browser's own local rendering of that instant via the round-trip through
  // `new Date(...).toISOString()` at submit time — good enough for an admin
  // console field, not a timezone-perfect display.
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

type AnnouncementSeverity = "info" | "warning" | "critical";
type AnnouncementScope = "global" | "restaurant";

export type AnnouncementFormValues = {
  id?: string;
  title: string;
  message: string;
  severity: AnnouncementSeverity;
  scope: AnnouncementScope;
  restaurantId: string | null;
  startsAt: string | null;
  endsAt: string | null;
};

export function AnnouncementForm({
  initial,
  restaurantOptions,
  onSaved,
}: {
  initial?: AnnouncementFormValues;
  restaurantOptions: { id: string; name: string }[];
  /** Called after a successful save — used by the parent to collapse the form back to a button. */
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [message, setMessage] = useState(initial?.message ?? "");
  const [severity, setSeverity] = useState<AnnouncementSeverity>(initial?.severity ?? "info");
  const [scope, setScope] = useState<AnnouncementScope>(initial?.scope ?? "global");
  const [restaurantId, setRestaurantId] = useState(initial?.restaurantId ?? "");
  const [startsAt, setStartsAt] = useState(isoToLocalInput(initial?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(isoToLocalInput(initial?.endsAt ?? null));
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    const payload = {
      title,
      message,
      severity,
      scope,
      restaurantId: scope === "restaurant" ? restaurantId || null : null,
      startsAt: localInputToIso(startsAt),
      endsAt: localInputToIso(endsAt),
    };

    startTransition(async () => {
      const result = initial?.id
        ? await updateAnnouncement({ ...payload, id: initial.id })
        : await createAnnouncement(payload);

      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      onSaved?.();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="Title" htmlFor="ann-title">
        <Input id="ann-title" value={title} maxLength={200} onChange={(e) => setTitle(e.currentTarget.value)} />
      </Field>
      <Field label="Message" htmlFor="ann-message">
        <Textarea id="ann-message" value={message} maxLength={1000} rows={3} onChange={(e) => setMessage(e.currentTarget.value)} />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Severity" htmlFor="ann-severity">
          <Select id="ann-severity" value={severity} onChange={(e) => setSeverity(e.currentTarget.value as AnnouncementSeverity)}>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </Select>
        </Field>
        <Field label="Scope" htmlFor="ann-scope">
          <Select id="ann-scope" value={scope} onChange={(e) => setScope(e.currentTarget.value as AnnouncementScope)}>
            <option value="global">Global — every customer</option>
            <option value="restaurant">One restaurant</option>
          </Select>
        </Field>
      </div>
      {scope === "restaurant" ? (
        <Field label="Restaurant" htmlFor="ann-restaurant">
          <Select id="ann-restaurant" value={restaurantId} onChange={(e) => setRestaurantId(e.currentTarget.value)}>
            <option value="">Select a restaurant…</option>
            {restaurantOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Starts" htmlFor="ann-starts" hint="Leave blank to start immediately once published">
          <Input id="ann-starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.currentTarget.value)} />
        </Field>
        <Field label="Ends" htmlFor="ann-ends" hint="Leave blank for no end date">
          <Input id="ann-ends" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.currentTarget.value)} />
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={pending || title.trim().length === 0 || message.trim().length === 0 || (scope === "restaurant" && !restaurantId)}
        >
          {pending ? "Saving…" : initial?.id ? "Save changes" : "Create draft"}
        </Button>
        {onSaved ? (
          <Button type="button" size="sm" variant="ghost" onClick={onSaved} disabled={pending}>
            Cancel
          </Button>
        ) : null}
      </div>
      <FormError>{error}</FormError>
    </div>
  );
}

export function AnnouncementLifecycleButtons({ id, isPublished, isArchived }: { id: string; isPublished: boolean; isArchived: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function runPublishToggle() {
    setError(null);
    startTransition(async () => {
      const result = await setAnnouncementPublishedState({ id, isPublished: !isPublished });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function runArchive() {
    setError(null);
    startTransition(async () => {
      const result = await archiveAnnouncement({ id });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (isArchived) return <span className="text-xs text-ink-muted">Archived</span>;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant={isPublished ? "ghost" : "secondary"} onClick={runPublishToggle} disabled={pending}>
        {pending ? "Saving…" : isPublished ? "Unpublish" : "Publish"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={runArchive} disabled={pending}>
        Archive
      </Button>
      <FormError>{error}</FormError>
    </div>
  );
}

export type AnnouncementListItem = AnnouncementFormValues & {
  id: string;
  isPublished: boolean;
  archivedAt: string | null;
  restaurantName: string | null;
  /** Computed server-side by lib/platform/announcements.ts's `announcementState`
   *  — not recomputed here, because that function lives in a `server-only`
   *  module and importing it into this client component would fail the
   *  build the same way lib/admin/settings-field-specs.ts would have. */
  state: "draft" | "archived" | "scheduled" | "live" | "expired";
};

const STATE_TONE: Record<AnnouncementListItem["state"], "neutral" | "info" | "success" | "warning"> = {
  draft: "neutral",
  scheduled: "info",
  live: "success",
  expired: "warning",
  archived: "neutral",
};

const STATE_LABEL: Record<AnnouncementListItem["state"], string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  live: "Live",
  expired: "Expired",
  archived: "Archived",
};

/** Owns which row (if any) is in edit mode and whether the create form is
 *  open — the one piece of client state the Operations page (a server
 *  component) cannot hold itself. */
export function AnnouncementsManager({
  announcements,
  restaurantOptions,
}: {
  announcements: AnnouncementListItem[];
  restaurantOptions: { id: string; name: string }[];
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div>
      {creating ? (
        <div className="rounded-brand border border-cream-300 bg-cream-50 p-4">
          <AnnouncementForm restaurantOptions={restaurantOptions} onSaved={() => setCreating(false)} />
        </div>
      ) : (
        <Button type="button" size="sm" onClick={() => setCreating(true)}>
          New announcement
        </Button>
      )}

      {announcements.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">No announcements yet.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {announcements.map((a) => (
            <li key={a.id} className="rounded-brand border border-cream-300 bg-cream-50 p-3">
              {editingId === a.id ? (
                <AnnouncementForm
                  restaurantOptions={restaurantOptions}
                  initial={a}
                  onSaved={() => setEditingId(null)}
                />
              ) : (
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={STATE_TONE[a.state]}>{STATE_LABEL[a.state]}</Badge>
                        <Badge tone={a.severity === "critical" ? "danger" : a.severity === "warning" ? "warning" : "neutral"}>
                          {a.severity}
                        </Badge>
                        <span className="text-xs text-ink-muted">
                          {a.scope === "global" ? "Global" : a.restaurantName ?? "One restaurant"}
                        </span>
                      </div>
                      <p className="mt-1 font-semibold text-ink">{a.title}</p>
                      <p className="mt-0.5 text-sm text-ink-soft">{a.message}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {a.archivedAt ? null : (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(a.id)}>
                        Edit
                      </Button>
                    )}
                    <AnnouncementLifecycleButtons id={a.id} isPublished={a.isPublished} isArchived={Boolean(a.archivedAt)} />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
