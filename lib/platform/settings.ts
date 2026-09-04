import "server-only";

import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

/**
 * Typed access to `admin_settings` (SRS §23 Platform Settings, Phase 9
 * "Settings affect the correct modules").
 *
 * Before this module, each caller wrote its own `.from("admin_settings")
 * .select("value").eq("key", ...)` and coerced the jsonb by hand — see
 * lib/actions/customer/checkout.ts and lib/actions/restaurant/order-status.ts.
 * That worked, but Phase 9 adds a settings UI that writes eleven keys, and
 * "what is the shape of this key's value?" needs one answer rather than one per
 * call site.
 *
 * Two deliberate choices:
 *
 *  1. `admin_settings` is world-readable under RLS (0006:
 *     admin_settings_select_all) because the customer checkout path needs the
 *     commission rate. Reads therefore use the RLS-bound client; only writes
 *     use the service role, behind requireSuperAdmin() in
 *     lib/actions/admin/settings.ts.
 *
 *  2. Every getter takes a fallback and never throws. A settings row going
 *     missing must not take down checkout or the vendor dashboard. The
 *     fallbacks below match the 0008 seed values exactly, so a missing row
 *     behaves like a fresh install rather than like zero.
 */

export const SETTING_KEYS = {
  commissionRate: "commission_rate",
  restaurantCancellationPenaltyRate: "restaurant_cancellation_penalty_rate",
  autoReadyGraceMinutes: "auto_ready_grace_minutes",
  defaultGracePeriodMinutes: "default_grace_period_minutes",
  defaultPreparationMinutes: "default_preparation_minutes",
  defaultSlotIntervalMinutes: "default_slot_interval_minutes",
  defaultSlotCapacity: "default_slot_capacity",
  grievanceSlaMinutes: "grievance_sla_minutes",
  customerFlagThresholds: "customer_flag_thresholds",
  liveOpsThresholds: "live_ops_thresholds",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export type SettingRow = {
  key: string;
  value: Json;
  description: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

/** Reads every setting. Used by the Phase 9 settings screen. */
export async function listSettings(): Promise<SettingRow[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("admin_settings")
    .select("key, value, description, updated_at, updated_by")
    .order("key");

  if (error || !data) return [];

  return data.map((row) => ({
    key: row.key,
    value: row.value,
    description: row.description,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }));
}

/**
 * Reads several settings in one round trip and returns them as a map. Dashboard
 * pages need four or five at once; issuing five queries for five scalars is
 * wasteful when the table has ten rows in total.
 */
export async function getSettings(keys: readonly string[]): Promise<Record<string, Json>> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.from("admin_settings").select("key, value").in("key", [...keys]);

  if (error || !data) return {};

  const map: Record<string, Json> = {};
  for (const row of data) map[row.key] = row.value;
  return map;
}

export async function getSetting(key: string): Promise<Json | null> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.from("admin_settings").select("value").eq("key", key).maybeSingle();

  if (error || !data) return null;
  return data.value;
}

/**
 * Numeric settings are stored as bare jsonb numbers (`0.08`, `15`), but a
 * hand-edited row could hold `"15"`. Both are accepted; anything else falls
 * back rather than producing NaN somewhere downstream in a money calculation.
 */
export function asNumber(value: Json | null | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function asRecord(value: Json | null | undefined): Record<string, Json> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, Json>;
  }
  return {};
}

/** Convenience readers with the 0008 seed values as fallbacks. */

export async function getCommissionRate(): Promise<number> {
  return asNumber(await getSetting(SETTING_KEYS.commissionRate), 0.08);
}

export async function getCancellationPenaltyRate(): Promise<number> {
  return asNumber(await getSetting(SETTING_KEYS.restaurantCancellationPenaltyRate), 0.49);
}

export type NewRestaurantDefaults = {
  preparationMinutes: number;
  gracePeriodMinutes: number;
  slotIntervalMinutes: number;
  slotCapacity: number;
};

/**
 * The values a newly created restaurant starts from (Phase 7 "Restaurant
 * creation", Phase 9 "Pickup capacity configuration",
 * "Preparation/grace policies"). Existing restaurants are unaffected by a
 * later change to these — they carry their own columns, which is what lets one
 * canteen run a 30-minute prep default without imposing it on everyone.
 */
export async function getNewRestaurantDefaults(): Promise<NewRestaurantDefaults> {
  const settings = await getSettings([
    SETTING_KEYS.defaultPreparationMinutes,
    SETTING_KEYS.defaultGracePeriodMinutes,
    SETTING_KEYS.defaultSlotIntervalMinutes,
    SETTING_KEYS.defaultSlotCapacity,
  ]);

  return {
    preparationMinutes: asNumber(settings[SETTING_KEYS.defaultPreparationMinutes], 10),
    gracePeriodMinutes: asNumber(settings[SETTING_KEYS.defaultGracePeriodMinutes], 15),
    slotIntervalMinutes: asNumber(settings[SETTING_KEYS.defaultSlotIntervalMinutes], 15),
    slotCapacity: asNumber(settings[SETTING_KEYS.defaultSlotCapacity], 8),
  };
}

export type LiveOpsThresholds = {
  dueSoonMinutes: number;
  notStartedMinutesBeforePickup: number;
  readyOverdueMinutes: number;
  pickupOverdueMinutes: number;
  capacityWarningRatio: number;
};

/** Windows used by the Live Operations Command Center (SRS V2 §F). */
export async function getLiveOpsThresholds(): Promise<LiveOpsThresholds> {
  const raw = asRecord(await getSetting(SETTING_KEYS.liveOpsThresholds));
  return {
    dueSoonMinutes: asNumber(raw.due_soon_minutes, 30),
    notStartedMinutesBeforePickup: asNumber(raw.not_started_minutes_before_pickup, 20),
    readyOverdueMinutes: asNumber(raw.ready_overdue_minutes, 5),
    pickupOverdueMinutes: asNumber(raw.pickup_overdue_minutes, 15),
    capacityWarningRatio: asNumber(raw.capacity_warning_ratio, 0.8),
  };
}

export type CustomerFlagThresholds = {
  highValueLifetimePaise: number;
  frequentCustomerOrders: number;
  repeatedNoShows: number;
  frequentCancellations: number;
  lookbackDays: number;
};

/** Thresholds behind the data-driven Customer 360 flags (SRS §7.3). */
export async function getCustomerFlagThresholds(): Promise<CustomerFlagThresholds> {
  const raw = asRecord(await getSetting(SETTING_KEYS.customerFlagThresholds));
  return {
    highValueLifetimePaise: asNumber(raw.high_value_lifetime_paise, 500_000),
    frequentCustomerOrders: asNumber(raw.frequent_customer_orders, 10),
    repeatedNoShows: asNumber(raw.repeated_no_shows, 2),
    frequentCancellations: asNumber(raw.frequent_cancellations, 3),
    lookbackDays: asNumber(raw.lookback_days, 90),
  };
}

/**
 * Writes a setting. Exported here rather than only inside the server action so
 * the settings screen, the seed-repair path and any future migration helper all
 * go through one function — but note it does NOT audit. Auditing is the
 * caller's job because only the caller knows the reason string, and SRS §11.5
 * requires the reason. lib/actions/admin/settings.ts is the sanctioned caller.
 */
export async function writeSettingValue(
  key: string,
  value: Json,
  actorId: string
): Promise<{ previous: Json | null }> {
  const supabase = createServiceRoleSupabaseClient();

  const { data: current } = await supabase
    .from("admin_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  const { error } = await supabase
    .from("admin_settings")
    .upsert(
      { key, value, updated_by: actorId, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );

  if (error) throw new Error(`Could not update setting "${key}": ${error.message}`);

  return { previous: current?.value ?? null };
}
