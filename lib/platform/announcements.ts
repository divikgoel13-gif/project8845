import "server-only";

import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";

/**
 * Announcements (SRS V2 §O).
 *
 * §O: "Announcements must be visible to customers only when explicitly
 * published." The RLS policy from 0006 (announcements_select_published) already
 * enforces the `is_published` half of that. What RLS does NOT enforce is the
 * time window or the Phase 9 archive flag, because those are presentation
 * decisions rather than access decisions — a scheduled announcement is not
 * secret, it is simply not due yet.
 *
 * So `listLiveAnnouncements` applies three predicates on top of RLS:
 *   is_published, not archived, and now() inside [starts_at, ends_at].
 * Null bounds mean "unbounded", which is how an operator posts something
 * indefinite without inventing a far-future end date.
 *
 * Restaurant scope: a customer browsing restaurant X should see global
 * announcements plus X's own, never restaurant Y's. That is a filter here
 * rather than in RLS for the same reason — the row is public once published;
 * showing it on the wrong page is just noise.
 */

// The DB column is unconstrained text, but every write path (see
// AnnouncementContentInput below and the Zod schema in
// lib/actions/admin/announcements.ts) only ever stores one of these values,
// so the read side can safely narrow to the literal union here rather than
// leaving every consumer to re-derive/assert it.
export type AnnouncementSeverity = "info" | "warning" | "critical";
export type AnnouncementScope = "global" | "restaurant";

export type LiveAnnouncement = {
  id: string;
  title: string;
  message: string;
  severity: AnnouncementSeverity;
  scope: AnnouncementScope;
  restaurantId: string | null;
  startsAt: string | null;
  endsAt: string | null;
};

export async function listLiveAnnouncements(options?: {
  restaurantId?: string | null;
  limit?: number;
}): Promise<LiveAnnouncement[]> {
  const supabase = createServerSupabaseClient();
  const nowIso = new Date().toISOString();

  let query = supabase
    .from("announcements")
    .select("id, title, message, severity, scope, restaurant_id, starts_at, ends_at")
    .eq("is_published", true)
    .is("archived_at", null)
    // `or` with an `is.null` branch is how PostgREST expresses "unbounded or in
    // window"; splitting it into two queries would be the alternative.
    .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
    .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
    .order("severity", { ascending: true })
    .order("starts_at", { ascending: false, nullsFirst: false })
    .limit(options?.limit ?? 5);

  if (options?.restaurantId) {
    query = query.or(`scope.eq.global,restaurant_id.eq.${options.restaurantId}`);
  } else {
    query = query.eq("scope", "global");
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    title: row.title,
    message: row.message,
    severity: row.severity as AnnouncementSeverity,
    scope: row.scope as AnnouncementScope,
    restaurantId: row.restaurant_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  }));
}

export type AdminAnnouncement = LiveAnnouncement & {
  isPublished: boolean;
  archivedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  restaurantName: string | null;
};

type AdminAnnouncementRow = {
  id: string;
  title: string;
  message: string;
  severity: AnnouncementSeverity;
  scope: AnnouncementScope;
  restaurant_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  is_published: boolean;
  archived_at: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  restaurants: { name: string } | null;
};

/**
 * Admin view: everything including drafts and archived rows. The archived ones
 * are returned rather than filtered out because §O requires archive to be an
 * audited state change, and an operator needs to see what they archived to
 * confirm it happened.
 */
export async function listAllAnnouncements(): Promise<AdminAnnouncement[]> {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("announcements")
    .select(
      `id, title, message, severity, scope, restaurant_id, starts_at, ends_at,
       is_published, archived_at, created_at, created_by, updated_at, updated_by,
       restaurants(name)`
    )
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return (data as unknown as AdminAnnouncementRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    message: row.message,
    severity: row.severity,
    scope: row.scope,
    restaurantId: row.restaurant_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    isPublished: row.is_published,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    restaurantName: row.restaurants?.name ?? null,
  }));
}

/**
 * Whether an announcement is currently being shown to customers. Derived here
 * so the admin list can say "Live" / "Scheduled" / "Expired" / "Draft" /
 * "Archived" instead of leaving an operator to compare timestamps by eye.
 */
export function announcementState(
  a: Pick<AdminAnnouncement, "isPublished" | "archivedAt" | "startsAt" | "endsAt">,
  now: Date = new Date()
): "draft" | "archived" | "scheduled" | "live" | "expired" {
  if (a.archivedAt) return "archived";
  if (!a.isPublished) return "draft";
  if (a.startsAt && new Date(a.startsAt) > now) return "scheduled";
  if (a.endsAt && new Date(a.endsAt) < now) return "expired";
  return "live";
}

// ── Writes. Auditing is the caller's job (lib/actions/admin/announcements.ts),
// same split as the other three lib/platform/*.ts modules — only the caller
// has the reason string §O's own audit requirement needs. ──────────────────

export type AnnouncementContentInput = {
  title: string;
  message: string;
  severity: AnnouncementSeverity;
  scope: AnnouncementScope;
  restaurantId: string | null;
  startsAt: string | null;
  endsAt: string | null;
};

/** New announcements are always created unpublished (a draft) — publishing
 *  is its own explicit, separately-audited action (§O), never a side effect
 *  of saving content. */
export async function createAnnouncement(input: AnnouncementContentInput, actorId: string): Promise<{ id: string }> {
  const supabase = createServiceRoleSupabaseClient();

  const { data, error } = await supabase
    .from("announcements")
    .insert({
      title: input.title,
      message: input.message,
      severity: input.severity,
      scope: input.scope,
      restaurant_id: input.restaurantId,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      is_published: false,
      created_by: actorId,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Could not create the announcement: ${error?.message ?? "unknown error"}`);
  return { id: data.id };
}

export async function updateAnnouncementContent(
  id: string,
  input: AnnouncementContentInput,
  actorId: string
): Promise<{ previous: AnnouncementContentInput | null }> {
  const supabase = createServiceRoleSupabaseClient();

  const { data: current } = await supabase
    .from("announcements")
    .select("title, message, severity, scope, restaurant_id, starts_at, ends_at")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("announcements")
    .update({
      title: input.title,
      message: input.message,
      severity: input.severity,
      scope: input.scope,
      restaurant_id: input.restaurantId,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(`Could not update the announcement: ${error.message}`);

  return {
    previous: current
      ? {
          title: current.title,
          message: current.message,
          severity: current.severity as AnnouncementSeverity,
          scope: current.scope as AnnouncementScope,
          restaurantId: current.restaurant_id,
          startsAt: current.starts_at,
          endsAt: current.ends_at,
        }
      : null,
  };
}

/** §O: "visible to customers only when the Super Admin explicitly turns/
 *  publishes them on." One boolean, one action, so the audit trail reads
 *  cleanly as a sequence of on/off decisions rather than being buried inside
 *  content edits. */
export async function setAnnouncementPublished(
  id: string,
  isPublished: boolean,
  actorId: string
): Promise<{ previous: boolean | null }> {
  const supabase = createServiceRoleSupabaseClient();

  const { data: current } = await supabase.from("announcements").select("is_published").eq("id", id).maybeSingle();

  const { error } = await supabase
    .from("announcements")
    .update({ is_published: isPublished, updated_by: actorId, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new Error(`Could not update the announcement: ${error.message}`);

  return { previous: current?.is_published ?? null };
}

/** Archiving is terminal (no unarchive) — §O lists archive alongside create/
 *  edit/publish/unpublish as one of five audited lifecycle actions, and a
 *  reversible archive would blur the line between "unpublish" (temporary)
 *  and "archive" (done with this announcement). A restored need becomes a
 *  new announcement, keeping each row's history unambiguous. */
export async function archiveAnnouncementRow(id: string, actorId: string): Promise<{ wasAlreadyArchived: boolean }> {
  const supabase = createServiceRoleSupabaseClient();

  const { data: current } = await supabase.from("announcements").select("archived_at").eq("id", id).maybeSingle();
  if (current?.archived_at) return { wasAlreadyArchived: true };

  const { error } = await supabase
    .from("announcements")
    .update({ archived_at: new Date().toISOString(), updated_by: actorId, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new Error(`Could not archive the announcement: ${error.message}`);
  return { wasAlreadyArchived: false };
}
