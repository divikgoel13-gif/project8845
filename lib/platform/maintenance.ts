import "server-only";

import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";

/**
 * Maintenance mode (SRS V2 §R).
 *
 * Three requirements from §R decide the design:
 *
 *  1. "Maintenance mode must be server-enforced" — so, like feature flags, the
 *     export that matters is `assertNotInMaintenance()`, which throws. Hiding
 *     the checkout button would not be enforcement.
 *
 *  2. "Existing paid orders must remain accessible" — this is why maintenance
 *     mode is NOT checked in middleware or in the admin layout. A blanket route
 *     block would lock a student out of the QR code for food they have already
 *     paid for, which turns a maintenance window into a support incident. The
 *     check therefore goes on WRITE paths (cart, checkout, new grievance) and
 *     never on read paths for existing orders.
 *
 *  3. "Clear message to users" — the message is stored alongside the flag so an
 *     operator can say "back at 14:00" rather than the app inventing copy.
 *
 * Scope: `maintenance_mode.key` is the module name, with 'global' as the row
 * seeded in 0008. §R allows "global or per-module", so a future 'checkout' or
 * 'grievances' row would be honoured by passing that key; `assertNotInMaintenance`
 * checks the global row and, optionally, one module row.
 *
 * Super admins are exempt. Someone has to be able to verify a fix during the
 * window, and locking the operator out of their own maintenance mode has an
 * obvious failure mode.
 */

export const GLOBAL_MAINTENANCE_KEY = "global";

export type MaintenanceState = {
  key: string;
  isActive: boolean;
  message: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

export class MaintenanceModeError extends Error {
  readonly scope: string;

  constructor(scope: string, message?: string | null) {
    super(
      message?.trim()
        ? message
        : "UNI8 is temporarily unavailable for maintenance. Existing paid orders are unaffected."
    );
    this.name = "MaintenanceModeError";
    this.scope = scope;
  }
}

export async function getMaintenanceState(key: string = GLOBAL_MAINTENANCE_KEY): Promise<MaintenanceState | null> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("maintenance_mode")
    .select("key, is_active, message, updated_at, updated_by")
    .eq("key", key)
    .maybeSingle();

  if (error || !data) return null;

  return {
    key: data.key,
    isActive: data.is_active,
    message: data.message,
    updatedAt: data.updated_at,
    updatedBy: data.updated_by,
  };
}

export async function listMaintenanceStates(): Promise<MaintenanceState[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("maintenance_mode")
    .select("key, is_active, message, updated_at, updated_by")
    .order("key");

  if (error || !data) return [];

  return data.map((row) => ({
    key: row.key,
    isActive: row.is_active,
    message: row.message,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }));
}

/** True when the global row (or the named module row) is active. */
export async function isMaintenanceActive(moduleKey?: string): Promise<boolean> {
  const global = await getMaintenanceState(GLOBAL_MAINTENANCE_KEY);
  if (global?.isActive) return true;
  if (!moduleKey || moduleKey === GLOBAL_MAINTENANCE_KEY) return false;
  const scoped = await getMaintenanceState(moduleKey);
  return Boolean(scoped?.isActive);
}

/**
 * Enforcement point for write actions.
 *
 * `actorRole` lets a caller exempt super admins without this module having to
 * re-read the profile: the caller has already run a guard, so it knows the role.
 * Passing nothing means "no exemption".
 */
export async function assertNotInMaintenance(options?: {
  moduleKey?: string;
  actorRole?: string;
}): Promise<void> {
  if (options?.actorRole === "super_admin") return;

  const global = await getMaintenanceState(GLOBAL_MAINTENANCE_KEY);
  if (global?.isActive) throw new MaintenanceModeError(GLOBAL_MAINTENANCE_KEY, global.message);

  const moduleKey = options?.moduleKey;
  if (!moduleKey || moduleKey === GLOBAL_MAINTENANCE_KEY) return;

  const scoped = await getMaintenanceState(moduleKey);
  if (scoped?.isActive) throw new MaintenanceModeError(moduleKey, scoped.message);
}

/** Auditing is the caller's job (lib/actions/admin/platform.ts). */
export async function writeMaintenanceState(
  key: string,
  isActive: boolean,
  message: string | null,
  actorId: string
): Promise<{ previous: { isActive: boolean; message: string | null } | null }> {
  const supabase = createServiceRoleSupabaseClient();

  const { data: current } = await supabase
    .from("maintenance_mode")
    .select("is_active, message")
    .eq("key", key)
    .maybeSingle();

  const { error } = await supabase.from("maintenance_mode").upsert(
    {
      key,
      is_active: isActive,
      message,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );

  if (error) throw new Error(`Could not update maintenance mode "${key}": ${error.message}`);

  return {
    previous: current ? { isActive: current.is_active, message: current.message } : null,
  };
}
