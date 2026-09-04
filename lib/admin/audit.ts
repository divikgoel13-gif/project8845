import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ADMIN_PAGE_SIZE } from "@/components/ui/pagination";
import type { Json } from "@/types/database";

/**
 * Global Audit Log (SRS §16/§18, Phase 9). The restaurant workspace's own
 * Audit Log page (`lib/admin/restaurant-workspace.ts`'s
 * `listRestaurantAuditLog`) already reads this exact same `audit_logs` table
 * scoped to one restaurant, and its own doc comment already promises "the
 * full payload is reachable through the global audit viewer" — this module
 * is that promise kept, not a second audit system.
 *
 * Two things the restaurant-scoped page cannot offer, by construction: an
 * ACTOR filter (an operator asking "what has this admin done, everywhere",
 * which has no restaurant to scope to), and the raw `before`/`after` JSON
 * payload. The restaurant page omits that payload as "unreadable at a glance
 * in a table row"; this page includes it too, but folded into a per-row
 * `<details>` disclosure (server-rendered, no client JS) rather than shown
 * inline — so the table stays scannable and the payload is still one click
 * away, not a second fetch away.
 *
 * `audit_logs` is genuinely large at platform scale (every privileged action
 * since launch), so — unlike the campus-scale in-process modules built in
 * Parts A-C — this reads with real database-level pagination and filtering,
 * the same discipline `listRestaurantAuditLog` already uses.
 */

export type AuditLogRow = {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  targetTable: string | null;
  targetId: string | null;
  restaurantId: string | null;
  restaurantName: string | null;
  reason: string | null;
  before: Json | null;
  after: Json | null;
  createdAt: string;
};

export type AuditLogFilters = {
  action?: string; // prefix match
  actorIds?: string[];
  restaurantId?: string;
  page?: number;
};

export async function listGlobalAuditLog(
  filters: AuditLogFilters = {}
): Promise<{ rows: AuditLogRow[]; total: number; page: number; pageSize: number }> {
  const supabase = createServerSupabaseClient();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = ADMIN_PAGE_SIZE;
  const from = (page - 1) * pageSize;

  let query = supabase
    .from("audit_logs")
    .select(
      "id, action, actor_id, actor_role, target_table, target_id, restaurant_id, reason, before, after, created_at, profiles(name), restaurants(name)",
      { count: "exact" }
    );

  const action = filters.action?.trim();
  if (action) query = query.ilike("action", `${action}%`);
  if (filters.actorIds && filters.actorIds.length > 0) query = query.in("actor_id", filters.actorIds);
  if (filters.restaurantId) query = query.eq("restaurant_id", filters.restaurantId);

  const { data, count } = await query.order("created_at", { ascending: false }).range(from, from + pageSize - 1);

  const rows = (
    (data ?? []) as unknown as {
      id: string;
      action: string;
      actor_id: string | null;
      actor_role: string | null;
      target_table: string | null;
      target_id: string | null;
      restaurant_id: string | null;
      reason: string | null;
      before: Json | null;
      after: Json | null;
      created_at: string;
      profiles: { name: string | null } | null;
      restaurants: { name: string } | null;
    }[]
  ).map((r) => ({
    id: r.id,
    action: r.action,
    actorId: r.actor_id,
    actorName: r.profiles?.name ?? null,
    actorRole: r.actor_role,
    targetTable: r.target_table,
    targetId: r.target_id,
    restaurantId: r.restaurant_id,
    restaurantName: r.restaurants?.name ?? null,
    reason: r.reason,
    before: r.before,
    after: r.after,
    createdAt: r.created_at,
  }));

  return { rows, total: count ?? 0, page, pageSize };
}

/** Resolves a typed name search to matching profile IDs, so the filter form
 *  can offer "search by actor name" instead of requiring a raw UUID. Capped
 *  at 50 — an audit search matching more than 50 accounts by name fragment
 *  is too broad to usefully narrow anything, and the caller should refine
 *  the search term instead. */
export async function findActorIdsByName(search: string): Promise<string[]> {
  const supabase = createServerSupabaseClient();
  const term = search.trim();
  if (!term) return [];

  const { data } = await supabase.from("profiles").select("id").ilike("name", `%${term}%`).limit(50);
  return (data ?? []).map((r) => r.id);
}
