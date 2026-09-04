"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRestaurantScope } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";

/**
 * Restaurant operations settings (SRS Phase 5 deliverables: "Restaurant
 * pickup-capacity controls," "Preparation cutoff controls," "Grace
 * period/no-show handling," "Restaurant operating hours/exceptions").
 * These write the exact columns/tables lib/scheduling/{feasibility,
 * capacity,hours}.ts already read — that engine has been fully built and
 * enforcing correctly since Phase 2/3; what was missing until now was
 * any Vendor-Admin-facing way to actually SET the values it reads. This
 * file is Vendor-Admin-only throughout (SRS §11: Staff has no settings
 * access).
 */

const OperationsSchema = z.object({
  restaurantId: z.string().uuid(),
  preparationDefaultMinutes: z.number().int().min(0).max(180),
  gracePeriodMinutes: z.number().int().min(0).max(180),
  pickupSlotIntervalMinutes: z.number().int().min(5).max(120),
  defaultSlotCapacity: z.number().int().min(1).max(500),
});

export async function updateRestaurantOperations(input: z.infer<typeof OperationsSchema>) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = OperationsSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: before } = await supabase
    .from("restaurants")
    .select("preparation_default_minutes, grace_period_minutes, pickup_slot_interval_minutes, default_slot_capacity")
    .eq("id", parsed.restaurantId)
    .single();

  const after = {
    preparation_default_minutes: parsed.preparationDefaultMinutes,
    grace_period_minutes: parsed.gracePeriodMinutes,
    pickup_slot_interval_minutes: parsed.pickupSlotIntervalMinutes,
    default_slot_capacity: parsed.defaultSlotCapacity,
  };

  const { error } = await supabase.from("restaurants").update(after).eq("id", parsed.restaurantId);
  if (error) throw new Error(error.message);

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "restaurant.operations_updated",
    targetTable: "restaurants",
    targetId: parsed.restaurantId,
    restaurantId: parsed.restaurantId,
    before,
    after,
  });

  revalidatePath("/vendor/settings");
}

const PauseSchema = z.object({
  restaurantId: z.string().uuid(),
  pausedUntil: z.string().datetime().nullable(), // null = paused indefinitely, until manually unpaused
  reason: z.string().trim().max(500).nullable(),
});

/**
 * SRS V2 §G: temporary restaurant pause — blocks NEW orders only.
 *
 * The status write is conditioned on the restaurant currently being 'active'
 * (`.eq("status", "active")`) rather than written unconditionally. V2.6 §60
 * added 'closed', and §32 puts Closed and Archived in Super Admin scope: an
 * unconditional `update({ status: 'paused' })` would let a vendor admin pull a
 * restaurant that support had closed — or one that is archived — back into a
 * vendor-controlled state, and the pause/unpause pair would then be able to
 * reopen it. Doing it as a conditional UPDATE rather than read-then-write also
 * closes the race between two admins acting at once.
 */
export async function pauseRestaurant(input: z.infer<typeof PauseSchema>) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = PauseSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const after = { status: "paused" as const, paused_until: parsed.pausedUntil, paused_reason: parsed.reason };
  const { data: updated, error } = await supabase
    .from("restaurants")
    .update(after)
    .eq("id", parsed.restaurantId)
    .eq("status", "active")
    .select("id");
  if (error) throw new Error(error.message);
  if (!updated || updated.length === 0) {
    throw new Error(
      "This restaurant is not currently active, so it cannot be paused. Contact UNI8 support."
    );
  }

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "restaurant.paused",
    targetTable: "restaurants",
    targetId: parsed.restaurantId,
    restaurantId: parsed.restaurantId,
    before: { status: "active" },
    after,
  });

  revalidatePath("/vendor/settings");
}

/** Reverses a §G pause only. Closed and archived are Super Admin states (§32). */
export async function unpauseRestaurant(input: { restaurantId: string }) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const restaurantId = z.string().uuid().parse(input.restaurantId);
  const supabase = createServiceRoleSupabaseClient();

  const after = { status: "active" as const, paused_until: null, paused_reason: null };
  const { data: updated, error } = await supabase
    .from("restaurants")
    .update(after)
    .eq("id", restaurantId)
    .eq("status", "paused")
    .select("id");
  if (error) throw new Error(error.message);
  if (!updated || updated.length === 0) {
    throw new Error(
      "This restaurant is not paused, so it cannot be resumed here. Contact UNI8 support."
    );
  }

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "restaurant.unpaused",
    targetTable: "restaurants",
    targetId: restaurantId,
    restaurantId,
    before: { status: "paused" },
    after,
  });

  revalidatePath("/vendor/settings");
}

const HoursSchema = z.object({
  restaurantId: z.string().uuid(),
  dayOfWeek: z.number().int().min(0).max(6),
  isClosed: z.boolean(),
  opensAt: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable(),
  closesAt: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable(),
});

/** Upserts one weekday's recurring hours (restaurant_hours has a unique (restaurant_id, day_of_week)). */
export async function setRestaurantHours(input: z.infer<typeof HoursSchema>) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = HoursSchema.parse(input);

  if (!parsed.isClosed && (!parsed.opensAt || !parsed.closesAt)) {
    throw new Error("Opening and closing times are required for an open day.");
  }

  const supabase = createServiceRoleSupabaseClient();
  const { error } = await supabase
    .from("restaurant_hours")
    .upsert(
      {
        restaurant_id: parsed.restaurantId,
        day_of_week: parsed.dayOfWeek,
        is_closed: parsed.isClosed,
        opens_at: parsed.isClosed ? null : parsed.opensAt,
        closes_at: parsed.isClosed ? null : parsed.closesAt,
      },
      { onConflict: "restaurant_id,day_of_week" }
    );

  if (error) throw new Error(error.message);

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "restaurant.hours_updated",
    targetTable: "restaurant_hours",
    restaurantId: parsed.restaurantId,
    after: { dayOfWeek: parsed.dayOfWeek, isClosed: parsed.isClosed, opensAt: parsed.opensAt, closesAt: parsed.closesAt },
  });

  revalidatePath("/vendor/settings");
}

const ExceptionSchema = z.object({
  restaurantId: z.string().uuid(),
  exceptionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isClosed: z.boolean(),
  opensAt: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable(),
  closesAt: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable(),
  note: z.string().trim().max(200).nullable(),
});

export async function addHourException(input: z.infer<typeof ExceptionSchema>) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = ExceptionSchema.parse(input);

  if (!parsed.isClosed && (!parsed.opensAt || !parsed.closesAt)) {
    throw new Error("Opening and closing times are required unless the day is marked closed.");
  }

  const supabase = createServiceRoleSupabaseClient();
  const { error } = await supabase
    .from("restaurant_hour_exceptions")
    .upsert(
      {
        restaurant_id: parsed.restaurantId,
        exception_date: parsed.exceptionDate,
        is_closed: parsed.isClosed,
        opens_at: parsed.isClosed ? null : parsed.opensAt,
        closes_at: parsed.isClosed ? null : parsed.closesAt,
        note: parsed.note,
      },
      { onConflict: "restaurant_id,exception_date" }
    );

  if (error) throw new Error(error.message);

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "restaurant.hour_exception_added",
    targetTable: "restaurant_hour_exceptions",
    restaurantId: parsed.restaurantId,
    after: parsed,
  });

  revalidatePath("/vendor/settings");
}

export async function removeHourException(input: { restaurantId: string; exceptionId: string }) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const restaurantId = z.string().uuid().parse(input.restaurantId);
  const exceptionId = z.string().uuid().parse(input.exceptionId);
  const supabase = createServiceRoleSupabaseClient();

  const { data: existing } = await supabase
    .from("restaurant_hour_exceptions")
    .select("restaurant_id, exception_date")
    .eq("id", exceptionId)
    .single();

  if (!existing || existing.restaurant_id !== restaurantId) {
    throw new Error("Exception not found for this restaurant.");
  }

  const { error } = await supabase.from("restaurant_hour_exceptions").delete().eq("id", exceptionId);
  if (error) throw new Error(error.message);

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "restaurant.hour_exception_removed",
    targetTable: "restaurant_hour_exceptions",
    targetId: exceptionId,
    restaurantId,
    before: { exceptionDate: existing.exception_date },
  });

  revalidatePath("/vendor/settings");
}

const CapacityOverrideSchema = z.object({
  restaurantId: z.string().uuid(),
  scope: z.enum(["day_of_week", "specific_date"]),
  dayOfWeek: z.number().int().min(0).max(6).nullable(),
  specificDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  slotStart: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  capacity: z.number().int().min(0).max(500), // 0 = fully blocked slot, per 0010_pickup_capacity.sql
});

/**
 * Per-slot capacity override (SRS §2 Pickup-slot capacity). Mirrors
 * lib/scheduling/capacity.ts#resolveSlotCapacity's exact precedence
 * (specific date checked before recurring day-of-week), and the
 * migration's own uniqueness constraints (one row per restaurant+day+slot,
 * or restaurant+date+slot).
 */
export async function setCapacityOverride(input: z.infer<typeof CapacityOverrideSchema>) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = CapacityOverrideSchema.parse(input);

  if (parsed.scope === "day_of_week" && parsed.dayOfWeek === null) {
    throw new Error("Day of week is required for a recurring override.");
  }
  if (parsed.scope === "specific_date" && !parsed.specificDate) {
    throw new Error("A date is required for a one-off override.");
  }

  const supabase = createServiceRoleSupabaseClient();
  const { error } = await supabase.from("pickup_capacity_overrides").insert({
    restaurant_id: parsed.restaurantId,
    day_of_week: parsed.scope === "day_of_week" ? parsed.dayOfWeek : null,
    specific_date: parsed.scope === "specific_date" ? parsed.specificDate : null,
    slot_start: parsed.slotStart,
    capacity: parsed.capacity,
  });

  if (error) {
    throw new Error(
      error.message.includes("duplicate key")
        ? "An override already exists for this slot — remove it first to change the value."
        : error.message
    );
  }

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "restaurant.capacity_override_added",
    targetTable: "pickup_capacity_overrides",
    restaurantId: parsed.restaurantId,
    after: parsed,
  });

  revalidatePath("/vendor/settings");
}

export async function removeCapacityOverride(input: { restaurantId: string; overrideId: string }) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const restaurantId = z.string().uuid().parse(input.restaurantId);
  const overrideId = z.string().uuid().parse(input.overrideId);
  const supabase = createServiceRoleSupabaseClient();

  const { data: existing } = await supabase
    .from("pickup_capacity_overrides")
    .select("restaurant_id")
    .eq("id", overrideId)
    .single();

  if (!existing || existing.restaurant_id !== restaurantId) {
    throw new Error("Override not found for this restaurant.");
  }

  const { error } = await supabase.from("pickup_capacity_overrides").delete().eq("id", overrideId);
  if (error) throw new Error(error.message);

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "restaurant.capacity_override_removed",
    targetTable: "pickup_capacity_overrides",
    targetId: overrideId,
    restaurantId,
  });

  revalidatePath("/vendor/settings");
}
