"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { recordAuditEvent } from "@/lib/audit/log";
import { writeSettingValue, SETTING_KEYS, type SettingKey } from "@/lib/platform/settings";
import type { Json } from "@/types/database";

/**
 * Generic `admin_settings` writer for every key EXCEPT `commission_rate`,
 * which keeps its own dedicated `updateCommissionRate` action
 * (lib/actions/admin/update-commission-rate.ts) — that action already
 * exists, is already correctly audited under the action name
 * `commission_rate.updated`, and SRS §11.5 asks for commission specifically
 * to be change-controlled; giving it a second, differently-named write path
 * through this generic action would split one setting's history across two
 * audit action names for no reason. The Settings page calls both actions
 * side by side.
 *
 * Per-key validation, not a bare `Json` passthrough: an admin_settings row
 * with the wrong shape doesn't fail loudly, it fails QUIETLY, three requests
 * later, wherever `asNumber`/`asRecord` (lib/platform/settings.ts) silently
 * falls back to a default. Rejecting a malformed value here, before it is
 * ever written, is strictly better than trusting the fallback to catch it.
 */

const RATE_KEYS = new Set<SettingKey>([SETTING_KEYS.restaurantCancellationPenaltyRate]);
const MINUTES_KEYS = new Set<SettingKey>([
  SETTING_KEYS.autoReadyGraceMinutes,
  SETTING_KEYS.defaultGracePeriodMinutes,
  SETTING_KEYS.defaultPreparationMinutes,
  SETTING_KEYS.defaultSlotIntervalMinutes,
]);
const COUNT_KEYS = new Set<SettingKey>([SETTING_KEYS.defaultSlotCapacity]);

/** The three structured-object keys, each with its own known sub-fields and bounds. */
const OBJECT_SHAPES: Partial<Record<SettingKey, z.ZodTypeAny>> = {
  [SETTING_KEYS.grievanceSlaMinutes]: z.object({
    urgent: z.object({ first_response: z.number().int().min(1), resolution: z.number().int().min(1) }),
    high: z.object({ first_response: z.number().int().min(1), resolution: z.number().int().min(1) }),
    normal: z.object({ first_response: z.number().int().min(1), resolution: z.number().int().min(1) }),
    low: z.object({ first_response: z.number().int().min(1), resolution: z.number().int().min(1) }),
  }),
  [SETTING_KEYS.customerFlagThresholds]: z.object({
    high_value_lifetime_paise: z.number().int().min(0),
    frequent_customer_orders: z.number().int().min(1),
    repeated_no_shows: z.number().int().min(1),
    frequent_cancellations: z.number().int().min(1),
    lookback_days: z.number().int().min(1),
  }),
  [SETTING_KEYS.liveOpsThresholds]: z.object({
    due_soon_minutes: z.number().int().min(1),
    not_started_minutes_before_pickup: z.number().int().min(1),
    ready_overdue_minutes: z.number().int().min(1),
    pickup_overdue_minutes: z.number().int().min(1),
    capacity_warning_ratio: z.number().min(0).max(1),
  }),
};

function validateValue(key: SettingKey, value: unknown): { ok: true; value: Json } | { ok: false; error: string } {
  const shape = OBJECT_SHAPES[key];
  if (shape) {
    const result = shape.safeParse(value);
    if (!result.success) {
      return { ok: false, error: result.error.issues[0]?.message ?? "That value doesn't match the expected shape." };
    }
    return { ok: true, value: result.data as Json };
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, error: "Enter a number." };
  }
  if (RATE_KEYS.has(key) && (value < 0 || value > 1)) {
    return { ok: false, error: "Enter a fraction between 0 and 1 (e.g. 0.49 for 49%)." };
  }
  if ((MINUTES_KEYS.has(key) || COUNT_KEYS.has(key)) && (value < 1 || !Number.isInteger(value))) {
    return { ok: false, error: "Enter a whole number of at least 1." };
  }
  return { ok: true, value };
}

const UpdateSettingSchema = z.object({
  key: z.string().trim().min(1),
  value: z.unknown(),
  reason: z.string().trim().min(1, "A reason is required for the audit log."),
});

const KNOWN_SETTING_KEYS = new Set<string>(
  Object.values(SETTING_KEYS).filter((k) => k !== SETTING_KEYS.commissionRate)
);

export async function updateSetting(input: z.input<typeof UpdateSettingSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = UpdateSettingSchema.parse(input);

  if (parsed.key === SETTING_KEYS.commissionRate) {
    return { ok: false as const, error: "Use the Commission Rate control above for this setting." };
  }
  if (!KNOWN_SETTING_KEYS.has(parsed.key)) {
    return { ok: false as const, error: `Unknown setting "${parsed.key}".` };
  }

  const validated = validateValue(parsed.key as SettingKey, parsed.value);
  if (!validated.ok) return { ok: false as const, error: validated.error };

  try {
    const { previous } = await writeSettingValue(parsed.key, validated.value, admin.id);

    await recordAuditEvent({
      actorId: admin.id,
      actorRole: admin.role,
      action: "admin_setting.updated",
      targetTable: "admin_settings",
      targetId: parsed.key,
      before: previous,
      after: validated.value,
      reason: parsed.reason,
    });
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not update the setting." };
  }

  revalidatePath("/admin/settings");
  revalidatePath("/admin/operations");
  return { ok: true as const };
}
