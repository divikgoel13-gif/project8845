"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";

/**
 * Walking times between restaurants (SRS §2, §9; V2.6 §U).
 *
 * The number matters operationally: a multi-restaurant group order uses it to
 * space pickup slots so a customer can physically reach the second counter.
 * `getWalkingTimeMinutes` reads the forward edge, falls back to the REVERSE edge
 * when the forward one is missing, and returns null when neither exists — at
 * which point `resolveImmediateAfterTime` refuses to schedule and the customer
 * must choose a fixed time. There is no platform-default number. That is why an
 * unset pair is left unset rather than written as 0: 0 would assert the two
 * counters are the same place and let the planner put two pickups at one instant.
 *
 * Edges are DIRECTIONAL. `walking_times` is unique on
 * `(restaurant_from_id, restaurant_to_id)` with a check that the two differ, and
 * campus geography can be asymmetric (one-way gates, stairs, a service corridor
 * that is only an exit). `setWalkingTime` therefore writes exactly one direction;
 * `setWalkingTimeBothWays` exists because entering the same number twice is the
 * common case, and it is explicit about doing two writes.
 */

const WalkingTimeSchema = z
  .object({
    fromRestaurantId: z.string().uuid(),
    toRestaurantId: z.string().uuid(),
    minutes: z.coerce.number().int().min(0).max(240),
  })
  .refine((v) => v.fromRestaurantId !== v.toRestaurantId, {
    message: "A restaurant cannot have a walking time to itself.",
    path: ["toRestaurantId"],
  });

async function writeEdge(
  supabase: ReturnType<typeof createServiceRoleSupabaseClient>,
  fromId: string,
  toId: string,
  minutes: number
): Promise<{ ok: true; before: unknown } | { ok: false; error: string }> {
  const { data: before } = await supabase
    .from("walking_times")
    .select("id, minutes")
    .eq("restaurant_from_id", fromId)
    .eq("restaurant_to_id", toId)
    .maybeSingle();

  const { error } = before
    ? await supabase
        .from("walking_times")
        .update({ minutes, updated_at: new Date().toISOString() })
        .eq("id", before.id)
    : await supabase
        .from("walking_times")
        .insert({ restaurant_from_id: fromId, restaurant_to_id: toId, minutes });

  if (error) return { ok: false, error: error.message };
  return { ok: true, before: before ?? null };
}

export async function setWalkingTime(input: z.input<typeof WalkingTimeSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = WalkingTimeSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  // Both ids are verified to exist because the FK error message ("violates
  // foreign key constraint walking_times_restaurant_to_id_fkey") is not a
  // sentence an operator can act on.
  const { data: pair } = await supabase
    .from("restaurants")
    .select("id, name")
    .in("id", [parsed.fromRestaurantId, parsed.toRestaurantId]);
  if ((pair ?? []).length !== 2) {
    return { ok: false as const, error: "One of those restaurants no longer exists." };
  }

  const result = await writeEdge(supabase, parsed.fromRestaurantId, parsed.toRestaurantId, parsed.minutes);
  if (!result.ok) return { ok: false as const, error: result.error };

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: "walking_time.set",
    targetTable: "walking_times",
    restaurantId: parsed.fromRestaurantId,
    before: result.before as Record<string, unknown> | null,
    after: { to: parsed.toRestaurantId, minutes: parsed.minutes },
  });

  revalidatePath(`/admin/restaurants/${parsed.fromRestaurantId}/walking-times`);
  revalidatePath(`/admin/restaurants/${parsed.toRestaurantId}/walking-times`);
  revalidatePath("/admin/settings");
  return { ok: true as const };
}

/**
 * Writes both directions with the same value. Two updates rather than one row
 * with a symmetric read, because the table's asymmetry is deliberate: an operator
 * who later discovers the return trip is longer must be able to change only that
 * direction without this action having baked symmetry into the schema.
 */
export async function setWalkingTimeBothWays(input: z.input<typeof WalkingTimeSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = WalkingTimeSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: pair } = await supabase
    .from("restaurants")
    .select("id, name")
    .in("id", [parsed.fromRestaurantId, parsed.toRestaurantId]);
  if ((pair ?? []).length !== 2) {
    return { ok: false as const, error: "One of those restaurants no longer exists." };
  }

  const outbound = await writeEdge(supabase, parsed.fromRestaurantId, parsed.toRestaurantId, parsed.minutes);
  if (!outbound.ok) return { ok: false as const, error: outbound.error };
  const inbound = await writeEdge(supabase, parsed.toRestaurantId, parsed.fromRestaurantId, parsed.minutes);
  if (!inbound.ok) {
    // The outbound edge stands. Reverting it would be a second write that could
    // itself fail, and one configured direction is still usable — the reader
    // falls back to the reverse edge — whereas a rollback would leave the pair
    // unschedulable.
    return {
      ok: false as const,
      error: `Saved the outbound direction, but the return direction failed: ${inbound.error}`,
    };
  }

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: "walking_time.set_both_ways",
    targetTable: "walking_times",
    restaurantId: parsed.fromRestaurantId,
    before: {
      outbound: outbound.before as Record<string, unknown> | null,
      inbound: inbound.before as Record<string, unknown> | null,
    },
    after: { other: parsed.toRestaurantId, minutes: parsed.minutes },
  });

  revalidatePath(`/admin/restaurants/${parsed.fromRestaurantId}/walking-times`);
  revalidatePath(`/admin/restaurants/${parsed.toRestaurantId}/walking-times`);
  revalidatePath("/admin/settings");
  return { ok: true as const };
}

const ClearSchema = z
  .object({
    fromRestaurantId: z.string().uuid(),
    toRestaurantId: z.string().uuid(),
    /** When true, removes the return direction as well. */
    bothWays: z.coerce.boolean().optional(),
  })
  .refine((v) => v.fromRestaurantId !== v.toRestaurantId, {
    message: "A restaurant cannot have a walking time to itself.",
    path: ["toRestaurantId"],
  });

/**
 * Clearing an edge is a delete, not a zero. The distinction is load-bearing:
 * `getWalkingTimeMinutes` returns null once no edge remains in either direction,
 * and the customer is then told no walking time is configured — whereas 0 minutes
 * would let the slot planner schedule two pickups at the same instant.
 */
export async function clearWalkingTime(input: z.input<typeof ClearSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = ClearSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const pairs: [string, string][] = parsed.bothWays
    ? [
        [parsed.fromRestaurantId, parsed.toRestaurantId],
        [parsed.toRestaurantId, parsed.fromRestaurantId],
      ]
    : [[parsed.fromRestaurantId, parsed.toRestaurantId]];

  const removed: { from: string; to: string; minutes: number }[] = [];
  for (const [fromId, toId] of pairs) {
    const { data: before } = await supabase
      .from("walking_times")
      .select("id, minutes")
      .eq("restaurant_from_id", fromId)
      .eq("restaurant_to_id", toId)
      .maybeSingle();
    if (!before) continue;

    const { error } = await supabase.from("walking_times").delete().eq("id", before.id);
    if (error) return { ok: false as const, error: error.message };
    removed.push({ from: fromId, to: toId, minutes: before.minutes });
  }

  if (removed.length === 0) return { ok: false as const, error: "That walking time was not set." };

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: "walking_time.cleared",
    targetTable: "walking_times",
    restaurantId: parsed.fromRestaurantId,
    before: { removed },
  });

  revalidatePath(`/admin/restaurants/${parsed.fromRestaurantId}/walking-times`);
  revalidatePath(`/admin/restaurants/${parsed.toRestaurantId}/walking-times`);
  revalidatePath("/admin/settings");
  return { ok: true as const };
}
