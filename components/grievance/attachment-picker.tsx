"use client";

import { useRef, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { STORAGE_BUCKETS, buildStoragePath } from "@/lib/storage/buckets";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "@/lib/grievance/attachments";

/**
 * Attachment picker shared by the admin ticket workspace and the customer
 * support thread (SRS §13 "private attachments").
 *
 * Files go to the private `grievance-attachments` bucket from the browser using
 * the signed-in user's own session, so migration 0018's Storage policies are the
 * access check — a customer can only write under their own open ticket, and a
 * resolved ticket rejects the upload in Postgres rather than in this component.
 * The server action that follows records the returned paths against the ticket.
 *
 * Upload happens on selection rather than on submit, deliberately: a 3 MB photo
 * on campus wifi takes long enough that doing it inside the reply submit would
 * look like a hung form. The trade-off is that a file can end up in the bucket
 * with no row pointing at it if the user picks a file and then abandons the
 * reply. That is the cheaper failure — an orphaned private object nobody can
 * reach without a signed link, versus a lost complaint attachment — and it is
 * recorded in docs/KNOWN_ISSUES.md with the cleanup job it wants.
 */

const MAX_BYTES = 5 * 1024 * 1024;

export type PendingAttachment = { path: string; name: string };

type Props = {
  ticketId: string;
  /** Paths uploaded so far, owned by the parent form so submit can send them. */
  value: PendingAttachment[];
  onChange: (next: PendingAttachment[]) => void;
  disabled?: boolean;
};

export function GrievanceAttachmentPicker({ ticketId, value, onChange, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = MAX_ATTACHMENTS_PER_MESSAGE - value.length;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    const picked = Array.from(files);
    if (picked.length > remaining) {
      setError(
        remaining === 0
          ? `You can attach ${MAX_ATTACHMENTS_PER_MESSAGE} files to one message.`
          : `Only ${remaining} more file${remaining === 1 ? "" : "s"} can be attached here.`,
      );
      return;
    }

    const oversized = picked.find((f) => f.size > MAX_BYTES);
    if (oversized) {
      setError(`"${oversized.name}" is larger than 5 MB. Try a smaller photo.`);
      return;
    }

    setBusy(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const uploaded: PendingAttachment[] = [];

      for (const file of picked) {
        const path = buildStoragePath("ticket", ticketId, file.name);
        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKETS.grievanceAttachments)
          .upload(path, file);
        if (uploadError) throw new Error(uploadError.message);
        uploaded.push({ path, name: file.name });
      }

      onChange([...value, ...uploaded]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That file could not be uploaded.");
    } finally {
      setBusy(false);
      // Clearing lets the same file be re-picked after a failure.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy || remaining <= 0}
          className="rounded-brand border border-cream-300 px-3 py-1.5 text-sm font-medium text-ink-soft transition hover:border-maroon-300 hover:text-maroon-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Attach a file"}
        </button>
        <p className="text-xs text-ink-muted">
          Images or PDF, up to 5 MB each. Attachments are private — only you and UNI8 support can
          open them.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />

      {value.length > 0 ? (
        <ul className="space-y-1">
          {value.map((a) => (
            <li
              key={a.path}
              className="flex items-center justify-between gap-3 rounded-brand bg-cream-100 px-3 py-1.5 text-sm text-ink-soft"
            >
              <span className="truncate">{a.name}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v.path !== a.path))}
                className="text-xs font-medium text-danger hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
