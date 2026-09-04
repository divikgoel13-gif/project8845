"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";

/**
 * Pickup schedule controls (SRS §9 pickup windows, §10.4 slot capacity, V2.6 §60).
 *
 * The three tables here are deliberately separate layers, and the actions keep
 * them separate rather than flattening everything into one "schedule" write:
 *
 *   restaurant_hours            -- the recurring weekly shape.
 *   restaurant_hour_exceptions  -- one dated override of that shape.
 *   pickup_capacity_overrides   -- how many orders one slot may hold.
 *
 * `resolveOpenWindow` reads them in that precedence order. Writing an exception
 * therefore never touches the weekly row: a festival closure must not erase what
 * "normal Friday" means, or the schedule cannot be restored after the exception
 * date passes.
 *
 * Times are stored as bare `time` values in the campus timezone (fixed +05:30,
 * `lib/scheduling/timezone.ts`). No instant is derived here, so no conversion is
 * needed — but that also means a time written here is only meaningful alongside
 * that fixed offset, which is why the pages show `TIMEZONE_NOTE`.
 */

/** `time` column input. Accepts `HH:MM` and `HH:MM:SS`; stored as given. */
const TimeSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Use a 24-hour time such as 09:30.");

/* ── Weekly hours (§9) ──────────────────────────────────────────────────── */

const DayHoursSchema = z
  .object({
    restaurantId: z.string().uuid(),
    dayOfWeek: z.coerce.number().int().min(0).max(6),
    isClosed: z.coerce.boolean(),
    opensAt: TimeSchema.optional().or(z.literal("")),
    closesAt: TimeSchema.optional().or(z.literal("")),
  })
  .refine((v) => v.isClosed || (Boolean(v.opensAt) && Boolean(v.closesAt)), {
    message: "An open day needs both an opening and a closing time.",
    path: ["opensAt"],
  });

/**
 * One day at a time, upserted on `(restaurant_id, day_of_week)`.
 *
 * A whole-week save was rejected: seven rows submitted together means one
 * validation failure discards six good edits, and the operator cannot tell which
 * day was rejected from a single form-level error.
 *
 * A closed day keeps its times as NULL rather than retaining yesterday's values,
 * because `resolveOpenWindow` treats a non-null pair as authoritative if
 * `is_closed` were ever cleared by another path.
 */
export async function setRestaurantDayHours(input: z.input<typeof DayHoursSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = DayHoursSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  if (!parsed.isClosed && parsed.opensAt && parsed.closesAt && parsed.closesAt <= parsed.opensAt) {
    // Lexicographic comparison is correct for zero-padded 24-hour times, and it
    // is the same ordering the database `time` type uses.
    return { ok: false as const, error: "Closing time must be after opening time." };
  }

  const { data: before } = await supabase
    .from("restaurant_hours")
    .select("id, day_of_week, opens_at, closes_at, is_closed")
    .eq("restaurant_id", parsed.restaurantId)
    .eq("day_of_week", parsed.dayOfWeek)
    .maybeSingle();

  const row = {
    restaurant_id: parsed.restaurantId,
    day_of_week: parsed.dayOfWeek,
    is_closed: parsed.isClosed,
    opens_at: parsed.isClosed ? null : parsed.opensAt || null,
    closes_at: parsed.isClosed ? null : parsed.closesAt || null,
  };

  const { error } = before
    ? await supabase.from("restaurant_hours").update(row).eq("id", before.id)
    : await supabase.from("restaurant_hours").insert(row);
  if (error) return { ok: false as const, error: error.message };

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: "restaurant.hours_updated",
    targetTable: "restaurant_hours",
    targetId: before?.id,
    restaurantId: parsed.restaurantId,
    before,
    after: row,
  });

  revalidatePath(`/admin/restaurants/${parsed.restaurantId}/pickup`);
  return { ok: true as const };
}

/* ── Dated exceptions (§9) ──────────────────────────────────────────────── */

const ExceptionSchema = z
  .object({
    restaurantId: z.string().uuid(),
    exceptionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date such as 2026-01-26."),
    isClosed: z.coerce.boolean(),
    opensAt: TimeSchema.optional().or(z.literal("")),
    closesAt: TimeSchema.optional().or(z.literal("")),
    note: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.isClosed || (Boolean(v.opensAt) && Boolean(v.closesAt)), {
    message: "A special-hours exception needs both an opening and a closing time.",
    path: ["opensAt"],
  });

/**
 * An exception is upserted on `(restaurant_id, exception_date)`, which is unique.
 * Submitting the same date twice is an edit, not a duplicate — the operator
 * correcting a typo in a closure should not have to delete the old row first.
 */
export async function upsertHourException(input: z.input<typeof ExceptionSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = ExceptionSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  if (!parsed.isClosed && parsed.opensAt && parsed.closesAt && parsed.closesAt <= parsed.opensAt) {
    return { ok: false as const, error: "Closing time must be after opening time." };
  }

  const { data: before } = await supabase
    .from("restaurant_hour_exceptions")
    .select("id, exception_date, is_closed, opens_at, closes_at, note")
    .eq("restaurant_id", parsed.restaurantId)
    .eq("exception_date", parsed.exceptionDate)
    .maybeSingle();

  const row = {
    restaurant_id: parsed.restaurantId,
    exception_date: parsed.exceptionDate,
    is_closed: parsed.isClosed,
    opens_at: parsed.isClosed ? null : parsed.opensAt || null,
    closes_at: parsed.isClosed ? null : parsed.closesAt || null,
    note: parsed.note?.length ? parsed.note : null,
  };

  const { error } = before
    ? await supabase.from("restaurant_hour_exceptions").update(row).eq("id", before.id)
    : await supabase.from("restaurant_hour_exceptions").insert(row);
  if (error) return { ok: false as const, error: error.message };

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: before ? "restaurant.hour_exception_updated" : "restaurant.hour_exception_added",
    targetTable: "restaurant_hour_exceptions",
    targetId: before?.id,
    restaurantId: parsed.restaurantId,
    before,
    after: row,
  });

  revalidatePath(`/admin/restaurants/${parsed.restaurantId}/pickup`);
  return { ok: true as const };
}

const DeleteExceptionSchema = z.object({
  restaurantId: z.string().uuid(),
  exceptionId: z.string().uuid(),
});

/**
 * Exceptions are the one thing in the console that IS deleted rather than dated
 * out. §P protects operational and financial history — orders, payments, audit
 * entries — and a future schedule hint is none of those. The audit entry keeps
 * the record of the removal, so the decision is still reconstructible.
 */
export async function deleteHourException(input: z.input<typeof DeleteExceptionSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = DeleteExceptionSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: before } = await supabase
    .from("restaurant_hour_exceptions")
    .select("id, restaurant_id, exception_date, is_closed, opens_at, closes_at, note")
    .eq("id", parsed.exceptionId)
    .maybeSingle();

  if (!before) return { ok: false as const, error: "That exception no longer exists." };
  if (before.restaurant_id !== parsed.restaurantId) {
    return { ok: false as const, error: "That exception belongs to a different restaurant." };
  }

  const { error } = await supabase.from("restaurant_hour_exceptions").delete().eq("id", parsed.exceptionId);
  if (error) return { ok: false as const, error: error.message };

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: "restaurant.hour_exception_removed",
    targetTable: "restaurant_hour_exceptions",
    targetId: parsed.exceptionId,
    restaurantId: parsed.restaurantId,
    before,
  });

  revalidatePath(`/admin/restaurants/${parsed.restaurantId}/pickup`);
  return { ok: true as const };
}

/* ── Slot capacity overrides (§10.4) ───────────────────────────────────── */

const CapacitySchema = z
  .object({
    restaurantId: z.string().uuid(),
    /** Exactly one of these two. The table enforces the same XOR. */
    dayOfWeek: z.coerce.number().int().min(0).max(6).optional(),
    specificDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date such as 2026-01-26.")
      .optional()
      .or(z.literal("")),
    slotStart: TimeSchema,
    /** 0 blocks the slot entirely — a legitimate value, not a missing one. */
    capacity: z.coerce.number().int().min(0).max(500),
  })
  .refine((v) => (v.dayOfWeek === undefined) !== !v.specificDate, {
    message: "Choose either a weekday or a single date, not both.",
    path: ["specificDate"],
  });

/**
 * Capacity overrides are upserted against whichever of the two partial unique
 * indexes applies, so re-submitting the same weekday/slot pair edits the number
 * rather than failing on a constraint the operator cannot see.
 *
 * A capacity of 0 is kept as a real value: §10.4 uses it to close one slot while
 * the rest of the day trades, which is not expressible through `restaurant_hours`.
 */
export async function upsertCapacityOverride(input: z.input<typeof CapacitySchema>) {
  const admin = await requireSuperAdmin();
  const parsed = CapacitySchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();
  const specificDate = parsed.specificDate?.length ? parsed.specificDate : null;

  let lookup = supabase
    .from("pickup_capacity_overrides")
    .select("id, day_of_week, specific_date, slot_start, capacity")
    .eq("restaurant_id", parsed.restaurantId)
    .eq("slot_start", parsed.slotStart);
  lookup = specificDate
    ? lookup.eq("specific_date", specificDate)
    : lookup.eq("day_of_week", parsed.dayOfWeek ?? -1);

  const { data: before } = await lookup.maybeSingle();

  const row = {
    restaurant_id: parsed.restaurantId,
    day_of_week: specificDate ? null : parsed.dayOfWeek ?? null,
    specific_date: specificDate,
    slot_start: parsed.slotStart,
    capacity: parsed.capacity,
  };

  const { error } = before
    ? await supabase.from("pickup_capacity_overrides").update({ capacity: parsed.capacity }).eq("id", before.id)
    : await supabase.from("pickup_capacity_overrides").insert(row);
  if (error) return { ok: false as const, error: error.message };

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: before ? "restaurant.slot_capacity_updated" : "restaurant.slot_capacity_added",
    targetTable: "pickup_capacity_overrides",
    targetId: before?.id,
    restaurantId: parsed.restaurantId,
    before,
    after: row,
  });

  revalidatePath(`/admin/restaurants/${parsed.restaurantId}/pickup`);
  return { ok: true as const };
}

const DeleteCapacitySchema = z.object({
  restaurantId: z.string().uuid(),
  overrideId: z.string().uuid(),
});

/**
 * Removing an override returns the slot to the restaurant's `default_slot_capacity`
 * — it does not set the capacity to zero. Those are opposite outcomes, so the UI
 * labels this "Remove override" rather than "Clear".
 */
export async function deleteCapacityOverride(input: z.input<typeof DeleteCapacitySchema>) {
  const admin = await requireSuperAdmin();
  const parsed = DeleteCapacitySchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: before } = await supabase
    .from("pickup_capacity_overrides")
    .select("id, restaurant_id, day_of_week, specific_date, slot_start, capacity")
    .eq("id", parsed.overrideId)
    .maybeSingle();

  if (!before) return { ok: false as const, error: "That override no longer exists." };
  if (before.restaurant_id !== parsed.restaurantId) {
    return { ok: false as const, error: "That override belongs to a different restaurant." };
  }

  const { error } = await supabase.from("pickup_capacity_overrides").delete().eq("id", parsed.overrideId);
  if (error) return { ok: false as const, error: error.message };

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: "restaurant.slot_capacity_removed",
    targetTable: "pickup_capacity_overrides",
    targetId: parsed.overrideId,
    restaurantId: parsed.restaurantId,
    before,
  });

  revalidatePath(`/admin/restaurants/${parsed.restaurantId}/pickup`);
  return { ok: true as const };
}
