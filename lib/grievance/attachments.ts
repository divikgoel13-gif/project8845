/**
 * Grievance attachment plumbing (SRS §13 "private attachments").
 *
 * The upload itself happens in the browser, straight to the private
 * `grievance-attachments` bucket, because streaming a file through a server
 * action would mean base64-inflating it into a request body for no benefit —
 * migration 0018 already puts the correct policies on the bucket, so the
 * browser's own session is the access check.
 *
 * What the browser CANNOT be trusted with is the row in `grievance_attachments`
 * that makes the file part of the ticket. That is written server-side, after a
 * guard, and only for paths that provably belong to the ticket being replied
 * to — otherwise a caller could point an attachment row at somebody else's
 * upload and the ticket page would happily sign a URL for it.
 *
 * Hence the two halves here:
 *   - `parseAttachmentPaths` — the fence between an untrusted string and a row.
 *   - `signAttachmentPaths` — short-lived signed URLs, generated per page render
 *     rather than stored, so a leaked link expires on its own.
 */

import { STORAGE_BUCKETS } from "@/lib/storage/buckets";

/**
 * Deliberately small. Attachments here are evidence (a photo of the wrong item,
 * a screenshot of a failed payment), not a file transfer channel, and every one
 * of them is something support may later have to review by hand.
 */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

/** How long a signed attachment link stays valid, in seconds. */
export const ATTACHMENT_URL_TTL_SECONDS = 300;

/**
 * Accepted upload types. Enforced in the browser for the error message and
 * again here because a client-side `accept` attribute is a hint, not a control.
 */
export const ATTACHMENT_ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";

const ALLOWED_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "pdf"];

/**
 * Validates browser-supplied storage paths against the ticket they claim to
 * belong to.
 *
 * The path convention is fixed by migration 0018 — `ticket/<ticket-uuid>/<file>`
 * — because the Storage policies read the second segment as the ticket id. That
 * makes the check here cheap and exact: same prefix, no traversal, known
 * extension, no duplicates.
 *
 * Throws rather than filtering silently. A rejected attachment that vanishes
 * without comment is worse than a failed reply: the customer thinks support has
 * seen their photo.
 */
export function parseAttachmentPaths(ticketId: string, paths: readonly string[] | undefined): string[] {
  if (!paths || paths.length === 0) return [];

  if (paths.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new Error(`Attach at most ${MAX_ATTACHMENTS_PER_MESSAGE} files to one message.`);
  }

  const prefix = `ticket/${ticketId}/`;
  const seen = new Set<string>();

  for (const path of paths) {
    if (typeof path !== "string" || path.length === 0 || path.length > 400) {
      throw new Error("That attachment could not be read. Try uploading it again.");
    }
    // Traversal and absolute paths, before anything else looks at the string.
    if (path.includes("..") || path.includes("//") || path.startsWith("/")) {
      throw new Error("That attachment path is not valid.");
    }
    if (!path.startsWith(prefix)) {
      throw new Error("That attachment does not belong to this ticket.");
    }
    const filename = path.slice(prefix.length);
    if (filename.length === 0 || filename.includes("/")) {
      throw new Error("That attachment path is not valid.");
    }
    const extension = filename.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      throw new Error("Attachments must be an image (PNG, JPG, WEBP) or a PDF.");
    }
    if (seen.has(path)) {
      throw new Error("That file was attached twice.");
    }
    seen.add(path);
  }

  return [...seen];
}

/** The display name for an attachment: the original filename, timestamp stripped. */
export function attachmentDisplayName(storagePath: string): string {
  const last = storagePath.split("/").pop() ?? storagePath;
  // buildStoragePath prefixes `<epoch>-`; hiding it keeps the UI readable while
  // the stored path stays unique.
  return last.replace(/^\d{10,}-/, "");
}

/** Minimal shape of the Supabase client this module needs — keeps it testable. */
type StorageSigner = {
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (
        path: string,
        expiresIn: number,
      ) => Promise<{ data: { signedUrl: string } | null; error: unknown }>;
    };
  };
};

export type SignedAttachment = {
  id: string;
  storagePath: string;
  name: string;
  /** Null when signing failed — the UI shows the name without a link. */
  url: string | null;
  uploadedBy: string | null;
  createdAt: string | null;
};

/**
 * Signs a batch of attachment paths for display.
 *
 * Signing is per-render and short-lived, so a URL that ends up in a browser
 * history or a copied message stops working within minutes. Failures are
 * tolerated one file at a time: a bucket hiccup should not blank out a ticket
 * page, so the attachment still renders, just without a link.
 */
export async function signAttachmentPaths<
  T extends { id: string; storagePath: string; uploadedBy?: string | null; createdAt?: string | null },
>(client: StorageSigner, rows: readonly T[]): Promise<SignedAttachment[]> {
  if (rows.length === 0) return [];

  const bucket = client.storage.from(STORAGE_BUCKETS.grievanceAttachments);

  return Promise.all(
    rows.map(async (row) => {
      let url: string | null = null;
      try {
        const { data } = await bucket.createSignedUrl(row.storagePath, ATTACHMENT_URL_TTL_SECONDS);
        url = data?.signedUrl ?? null;
      } catch {
        url = null;
      }
      return {
        id: row.id,
        storagePath: row.storagePath,
        name: attachmentDisplayName(row.storagePath),
        url,
        uploadedBy: row.uploadedBy ?? null,
        createdAt: row.createdAt ?? null,
      };
    }),
  );
}
