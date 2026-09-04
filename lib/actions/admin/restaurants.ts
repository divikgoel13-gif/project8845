"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";
import { getNewRestaurantDefaults } from "@/lib/platform/settings";

/**
 * Restaurant lifecycle (SRS §6 "Restaurant creation and lifecycle", §29.1
 * classification, V2.6 §60 four states).
 *
 * Everything here is a super-admin-only audited mutation. Two rules shape the
 * whole file:
 *
 *  - No restaurant is ever deleted (§P). Removal is `status = 'archived'` plus
 *    `archived_at`, so the workspace and its financial history stay readable.
 *  - A state change carries provenance: reason, actor and timestamp. An
 *    operator finding a closed restaurant needs to know who closed it and why
 *    without opening the audit log.
 */

/**
 * §29.1: the classification dropdown is required, and choosing Inside
 * University requires a University Place Name. Modelled as a discriminated
 * union so the pairing is impossible to get wrong in TypeScript as well as in
 * the database check constraint — an outside-university restaurant cannot even
 * express a place name.
 */
const ClassificationSchema = z.discriminatedUnion("locationType", [
  z.object({
    locationType: z.literal("inside_university"),
    universityPlaceName: z
      .string()
      .trim()
      .min(1, "A university place name is required for an inside-university restaurant."),
  }),
  z.object({
    locationType: z.literal("outside_university"),
    universityPlaceName: z.literal("").optional(),
  }),
]);

/**
 * Slugs are lowercase, hyphenated and unique — they are the customer-facing URL
 * segment, so they are validated rather than derived silently from the name: two
 * restaurants called "Cafe 24" must not race for the same slug.
 */
const CreateRestaurantSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required.").max(120),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2)
      .max(60)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens."),
    location: z.string().trim().max(200).optional(),
    description: z.string().trim().max(1_000).optional(),
  })
  .and(ClassificationSchema);

export type CreateRestaurantInput = z.input<typeof CreateRestaurantSchema>;

export async function createRestaurant(input: CreateRestaurantInput) {
  const admin = await requireSuperAdmin();
  const parsed = CreateRestaurantSchema.parse(input);

  const supabase = createServiceRoleSupabaseClient();

  // Defaults are read from platform settings at creation time and COPIED onto
  // the row. A later settings change must not silently re-time an existing
  // restaurant's prep window (SRS §11.5 reasoning applied to operations).
  const defaults = await getNewRestaurantDefaults();

  const { data: clash } = await supabase.from("restaurants").select("id").eq("slug", parsed.slug).maybeSingle();
  if (clash) {
    return { ok: false as const, error: `The slug "${parsed.slug}" is already in use.` };
  }

  const { data, error } = await supabase
    .from("restaurants")
    .insert({
      name: parsed.name,
      slug: parsed.slug,
      status: "active",
      location: parsed.location || null,
      description: parsed.description || null,
      location_type: parsed.locationType,
      university_place_name:
        parsed.locationType === "inside_university" ? parsed.universityPlaceName : null,
      preparation_default_minutes: defaults.preparationMinutes,
      grace_period_minutes: defaults.gracePeriodMinutes,
      pickup_slot_interval_minutes: defaults.slotIntervalMinutes,
      default_slot_capacity: defaults.slotCapacity,
      status_changed_at: new Date().toISOString(),
      status_changed_by: admin.id,
    })
    .select("id, name, slug, status, location_type, university_place_name")
    .single();

  if (error || !data) {
    return { ok: false as const, error: error?.message ?? "Could not create the restaurant." };
  }

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: "restaurant.created",
    targetTable: "restaurants",
    targetId: data.id,
    restaurantId: data.id,
    after: { ...data, defaultsApplied: defaults },
  });

  revalidatePath("/admin/restaurants");
  return { ok: true as const, restaurantId: data.id as string };
}

/* ─────────────────────────────────────────────────────────────────────────
   §29.1 classification changes are separately audited
   ───────────────────────────────────────────────────────────────────────── */

/**
 * §29.1: "Changes are audit logged." Split out from a general settings update
 * because this one field decides whether a customer sees the §29.2 physical
 * access warning before ordering — turning it off silently removes a statement
 * UNI8 has made about campus access.
 */
export async function updateRestaurantClassification(
  input: { restaurantId: string; reason?: string } & z.input<typeof ClassificationSchema>
) {
  const admin = await requireSuperAdmin();
  const { restaurantId, reason } = z
    .object({ restaurantId: z.string().uuid(), reason: z.string().trim().max(500).optional() })
    .parse(input);
  const parsed = ClassificationSchema.parse(input);

  const supabase = createServiceRoleSupabaseClient();

  const { data: before } = await supabase
    .from("restaurants")
    .select("id, location_type, university_place_name")
    .eq("id", restaurantId)
    .maybeSingle();

  if (!before) return { ok: false as const, error: "Restaurant not found." };

  const after = {
    location_type: parsed.locationType,
    university_place_name:
      parsed.locationType === "inside_university" ? parsed.universityPlaceName : null,
  };

  const { error } = await supabase.from("restaurants").update(after).eq("id", restaurantId);
  if (error) return { ok: false as const, error: error.message };

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: "restaurant.classification_changed",
    targetTable: "restaurants",
    targetId: restaurantId,
    restaurantId,
    before,
    after,
    reason: reason ?? undefined,
  });

  revalidatePath(`/admin/restaurants/${restaurantId}/settings`);
  revalidatePath("/admin/restaurants");
  return { ok: true as const };
}

/* ─────────────────────────────────────────────────────────────────────────
   §60 state transitions
   ───────────────────────────────────────────────────────────────────────── */

/**
 * One action for all four states rather than four near-identical actions,
 * because the columns that must be cleared on the way OUT of a state are the
 * easiest thing to forget: reopening a closed restaurant that keeps its
 * `closed_reason` shows an active restaurant with a stale explanation attached.
 *
 * `pausedUntil` is only meaningful for `paused`; a timed pause that has elapsed
 * is left in the database on purpose and resolved at read time
 * (`restaurantOperationalState`) so the reason survives.
 */
const SetStatusSchema = z
  .object({
    restaurantId: z.string().uuid(),
    status: z.enum(["active", "paused", "closed", "archived"]),
    reason: z.string().trim().max(500).optional(),
    /** ISO instant. Only used when status is `paused`. */
    pausedUntil: z.string().datetime().optional(),
  })
  .refine((v) => v.status === "active" || (v.reason?.length ?? 0) > 0, {
    message: "A reason is required when pausing, closing or archiving a restaurant.",
    path: ["reason"],
  });

export async function setRestaurantStatus(input: z.input<typeof SetStatusSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = SetStatusSchema.parse(input);
  const now = new Date().toISOString();

  const supabase = createServiceRoleSupabaseClient();

  const { data: before } = await supabase
    .from("restaurants")
    .select("id, name, status, paused_until, paused_reason, closed_at, closed_reason, archived_at")
    .eq("id", parsed.restaurantId)
    .maybeSingle();

  if (!before) return { ok: false as const, error: "Restaurant not found." };

  // Built explicitly per target state so no stale column survives a transition.
  const patch: Record<string, string | null> = {
    status: parsed.status,
    status_changed_at: now,
    status_changed_by: admin.id,
    paused_until: null,
    paused_reason: null,
    closed_at: null,
    closed_reason: null,
    archived_at: null,
  };

  if (parsed.status === "paused") {
    patch.paused_until = parsed.pausedUntil ?? null;
    patch.paused_reason = parsed.reason ?? null;
  } else if (parsed.status === "closed") {
    patch.closed_at = now;
    patch.closed_reason = parsed.reason ?? null;
  } else if (parsed.status === "archived") {
    patch.archived_at = now;
    // Archiving keeps the closure narrative: an archived restaurant is almost
    // always archived because it closed, and finance reads both.
    patch.closed_at = before.closed_at ?? now;
    patch.closed_reason = parsed.reason ?? before.closed_reason ?? null;
  }

  const { error } = await supabase.from("restaurants").update(patch).eq("id", parsed.restaurantId);
  if (error) return { ok: false as const, error: error.message };

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: `restaurant.${parsed.status === "active" ? "reactivated" : parsed.status}`,
    targetTable: "restaurants",
    targetId: parsed.restaurantId,
    restaurantId: parsed.restaurantId,
    before,
    after: patch,
    reason: parsed.reason ?? undefined,
  });

  revalidatePath("/admin/restaurants");
  revalidatePath(`/admin/restaurants/${parsed.restaurantId}/dashboard`);
  revalidatePath(`/admin/restaurants/${parsed.restaurantId}/settings`);
  return { ok: true as const };
}

/**
 * Operational policy fields the Super Admin can set per restaurant (§6, §9).
 * Separate from the classification action so the §29.1 audit entry stays a
 * single-purpose record rather than being buried inside a general save.
 */
const UpdateOperationsSchema = z.object({
  restaurantId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  location: z.string().trim().max(200).optional(),
  description: z.string().trim().max(1_000).optional(),
  preparationDefaultMinutes: z.coerce.number().int().min(0).max(240),
  gracePeriodMinutes: z.coerce.number().int().min(0).max(240),
  pickupSlotIntervalMinutes: z.coerce.number().int().min(1).max(120),
  defaultSlotCapacity: z.coerce.number().int().min(1).max(500),
});

export async function updateRestaurantOperations(input: z.input<typeof UpdateOperationsSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = UpdateOperationsSchema.parse(input);

  const supabase = createServiceRoleSupabaseClient();

  const { data: before } = await supabase
    .from("restaurants")
    .select(
      `id, name, location, description, preparation_default_minutes, grace_period_minutes,
       pickup_slot_interval_minutes, default_slot_capacity`
    )
    .eq("id", parsed.restaurantId)
    .maybeSingle();

  if (!before) return { ok: false as const, error: "Restaurant not found." };

  const after = {
    name: parsed.name,
    location: parsed.location || null,
    description: parsed.description || null,
    preparation_default_minutes: parsed.preparationDefaultMinutes,
    grace_period_minutes: parsed.gracePeriodMinutes,
    pickup_slot_interval_minutes: parsed.pickupSlotIntervalMinutes,
    default_slot_capacity: parsed.defaultSlotCapacity,
  };

  const { error } = await supabase.from("restaurants").update(after).eq("id", parsed.restaurantId);
  if (error) return { ok: false as const, error: error.message };

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: "restaurant.operations_updated",
    targetTable: "restaurants",
    targetId: parsed.restaurantId,
    restaurantId: parsed.restaurantId,
    before,
    after,
  });

  revalidatePath(`/admin/restaurants/${parsed.restaurantId}/settings`);
  revalidatePath(`/admin/restaurants/${parsed.restaurantId}/dashboard`);
  return { ok: true as const };
}
