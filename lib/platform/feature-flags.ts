import "server-only";

import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";

/**
 * Feature flags (SRS V2 §Q).
 *
 * The requirement that shapes this whole module is one sentence: "A disabled
 * feature must be blocked at the server/action level, not merely hidden in the
 * UI." Hiding a button is not a feature flag; it is a cosmetic change that a
 * crafted POST walks straight past. So the export that matters here is
 * `assertFeatureEnabled`, which THROWS, and which server actions call before
 * doing any work.
 *
 * `isFeatureEnabled` exists for rendering decisions and returns a boolean. Both
 * are needed: the UI should not show a control that would immediately fail, but
 * the UI's judgment is never what enforces the rule.
 *
 * Fail-closed vs fail-open: if the flags table cannot be read, this module
 * returns the DEFAULT below rather than throwing, and the defaults mirror the
 * 0008 seed. A transient database hiccup should not disable ratings for
 * everyone, and it must not silently ENABLE something an operator turned off —
 * hence `promotions` defaults to false, matching the seed.
 */

export const FEATURE_FLAGS = {
  multiRestaurantOrdering: "multi_restaurant_ordering",
  ratings: "ratings",
  announcements: "announcements",
  optionalQuantityInventory: "optional_quantity_inventory",
  promotions: "promotions",
} as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

/** Mirrors 0008_seed_platform_settings.sql. */
const DEFAULTS: Record<string, boolean> = {
  [FEATURE_FLAGS.multiRestaurantOrdering]: true,
  [FEATURE_FLAGS.ratings]: true,
  [FEATURE_FLAGS.announcements]: true,
  [FEATURE_FLAGS.optionalQuantityInventory]: true,
  [FEATURE_FLAGS.promotions]: false,
};

export type FeatureFlagRow = {
  key: string;
  enabled: boolean;
  description: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

export class FeatureDisabledError extends Error {
  readonly flag: string;

  constructor(flag: string, message?: string) {
    super(message ?? "This feature is currently disabled by the platform administrator.");
    this.name = "FeatureDisabledError";
    this.flag = flag;
  }
}

export async function listFeatureFlags(): Promise<FeatureFlagRow[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("feature_flags")
    .select("key, enabled, description, updated_at, updated_by")
    .order("key");

  if (error || !data) return [];

  return data.map((row) => ({
    key: row.key,
    enabled: row.enabled,
    description: row.description,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }));
}

export async function isFeatureEnabled(key: string): Promise<boolean> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("key", key)
    .maybeSingle();

  if (error || !data) return DEFAULTS[key] ?? false;
  return data.enabled;
}

/**
 * The enforcement point. Call this at the TOP of any server action gated by a
 * flag, before validation and before any write:
 *
 *   await assertFeatureEnabled(FEATURE_FLAGS.ratings);
 *
 * Throwing (rather than returning false) is what makes it impossible to forget
 * to check the result.
 */
export async function assertFeatureEnabled(key: string, message?: string): Promise<void> {
  const enabled = await isFeatureEnabled(key);
  if (!enabled) throw new FeatureDisabledError(key, message);
}

/**
 * Sets a flag. Auditing is the caller's responsibility (see
 * lib/actions/admin/platform.ts) because §Q requires the change to be audited
 * with a reason, and only the caller has one.
 */
export async function writeFeatureFlag(
  key: string,
  enabled: boolean,
  actorId: string
): Promise<{ previous: boolean | null }> {
  const supabase = createServiceRoleSupabaseClient();

  const { data: current } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("key", key)
    .maybeSingle();

  const { error } = await supabase
    .from("feature_flags")
    .upsert(
      { key, enabled, updated_by: actorId, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );

  if (error) throw new Error(`Could not update feature flag "${key}": ${error.message}`);

  return { previous: current?.enabled ?? null };
}
