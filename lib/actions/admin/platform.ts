"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { recordAuditEvent } from "@/lib/audit/log";
import { writeFeatureFlag, FEATURE_FLAGS } from "@/lib/platform/feature-flags";
import { writeMaintenanceState, GLOBAL_MAINTENANCE_KEY } from "@/lib/platform/maintenance";

/**
 * Audited wrappers for feature flags (SRS §Q) and maintenance mode (§R).
 *
 * This is the file `lib/platform/feature-flags.ts` and
 * `lib/platform/maintenance.ts` already point to in their own doc comments —
 * both modules' `write*` functions deliberately do NOT audit themselves,
 * because only a caller with a reason string can. §Q and §R each say the
 * change "is audited"; neither says WHY is optional, so both actions here
 * require one, the same bar `updateCommissionRate` already set for §11.5.
 *
 * Both actions revalidate `/admin/settings` (where the controls live) and
 * `/admin/operations` (whose footer already links out to Settings and whose
 * live-ops thresholds a maintenance window doesn't change, but whose
 * "is anything currently degraded" framing benefits from a fresh read).
 */

const UpdateFeatureFlagSchema = z.object({
  key: z.string().trim().min(1),
  enabled: z.boolean(),
  reason: z.string().trim().min(1, "A reason is required for the audit log."),
});

const KNOWN_FLAG_KEYS = new Set<string>(Object.values(FEATURE_FLAGS));

export async function updateFeatureFlag(input: z.input<typeof UpdateFeatureFlagSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = UpdateFeatureFlagSchema.parse(input);

  // Not a hard schema constraint (a future flag could be added by migration
  // before this list is updated) — a soft warning path would be more
  // permissive, but §Q's own worked examples are a closed, deliberately
  // short list, and a typo'd key here would silently create a NEW flag that
  // no server-side `assertFeatureEnabled` call ever checks — worse than
  // rejecting it outright.
  if (!KNOWN_FLAG_KEYS.has(parsed.key)) {
    return { ok: false as const, error: `Unknown feature flag "${parsed.key}".` };
  }

  try {
    const { previous } = await writeFeatureFlag(parsed.key, parsed.enabled, admin.id);

    await recordAuditEvent({
      actorId: admin.id,
      actorRole: admin.role,
      action: "feature_flag.updated",
      targetTable: "feature_flags",
      targetId: parsed.key,
      before: previous,
      after: parsed.enabled,
      reason: parsed.reason,
    });
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not update the flag." };
  }

  revalidatePath("/admin/settings");
  revalidatePath("/admin/operations");
  return { ok: true as const };
}

const UpdateMaintenanceModeSchema = z.object({
  key: z.string().trim().min(1).default(GLOBAL_MAINTENANCE_KEY),
  isActive: z.boolean(),
  message: z.string().trim().max(500).nullable(),
  reason: z.string().trim().min(1, "A reason is required for the audit log."),
});

export async function updateMaintenanceMode(input: z.input<typeof UpdateMaintenanceModeSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = UpdateMaintenanceModeSchema.parse(input);

  try {
    const { previous } = await writeMaintenanceState(parsed.key, parsed.isActive, parsed.message, admin.id);

    await recordAuditEvent({
      actorId: admin.id,
      actorRole: admin.role,
      action: "maintenance_mode.updated",
      targetTable: "maintenance_mode",
      targetId: parsed.key,
      before: previous,
      after: { isActive: parsed.isActive, message: parsed.message },
      reason: parsed.reason,
    });
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not update maintenance mode." };
  }

  revalidatePath("/admin/settings");
  revalidatePath("/admin/operations");
  return { ok: true as const };
}
