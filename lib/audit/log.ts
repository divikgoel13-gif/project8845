import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/auth/roles";
import type { Json } from "@/types/database";

export type AuditEntry = {
  actorId: string | null;
  actorRole: AppRole | null;
  action: string; // e.g. "commission_rate.updated", "staff.disabled", "order.cancelled"
  targetTable?: string;
  targetId?: string;
  restaurantId?: string; // denormalized, powers restaurant-scoped audit views (SRS §6)
  before?: unknown;
  after?: unknown;
  reason?: string;
};

/**
 * Records a privileged-action audit entry (SRS §2, §6, §17: "Admin audit
 * log — Records privileged changes with actor, time, target and
 * before/after context"). This is the ONLY sanctioned way to write to
 * audit_logs — there is deliberately no client-writable RLS policy on
 * that table (see 0006_rls_policies.sql), so every entry is guaranteed to
 * have gone through a real server code path.
 *
 * Call this from inside the SAME Server Action that performs the mutation,
 * after the mutation succeeds, so a failed mutation never produces a
 * misleading audit trail.
 */
export async function recordAuditEvent(entry: AuditEntry): Promise<void> {
  const supabase = createServiceRoleSupabaseClient();

  // `before`/`after` are typed `unknown` at the call site (callers pass plain
  // business-data snapshots), but the `audit_logs.before`/`after` columns are
  // jsonb, so this round-trip both satisfies the Json type at compile time
  // and guarantees at runtime that what we store is exactly what a jsonb
  // column can hold (e.g. a stray Date becomes the same ISO string it would
  // become on the way into Postgres anyway).
  const toJson = (value: unknown): Json | null => (value === undefined ? null : (JSON.parse(JSON.stringify(value)) as Json));

  const { error } = await supabase.from("audit_logs").insert({
    actor_id: entry.actorId,
    actor_role: entry.actorRole,
    action: entry.action,
    target_table: entry.targetTable ?? null,
    target_id: entry.targetId ?? null,
    restaurant_id: entry.restaurantId ?? null,
    before: toJson(entry.before),
    after: toJson(entry.after),
    reason: entry.reason ?? null,
  });

  if (error) {
    // Deliberately does not throw: an audit-log write failure should not
    // silently roll back an already-succeeded business mutation, but it
    // must never be swallowed silently either — surface it loudly to
    // observability (SRS §3: "Observability... audit events").
    console.error("[audit] failed to record audit event", entry.action, error);
  }
}
