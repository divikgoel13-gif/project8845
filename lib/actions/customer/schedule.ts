"use server";

import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { checkPickupFeasibility, FEASIBILITY_MESSAGES } from "@/lib/scheduling/feasibility";
import { resolveImmediateAfterTime } from "@/lib/scheduling/walking-time";
import { buildCampusInstant } from "@/lib/scheduling/timezone";
import { getCurrentCartGrouped } from "@/lib/actions/customer/cart";

const SequenceStepSchema = z.discriminatedUnion("mode", [
  z.object({
    restaurantId: z.string().uuid(),
    mode: z.literal("fixed_time"),
    isoDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  }),
  z.object({
    restaurantId: z.string().uuid(),
    mode: z.literal("immediately_after"),
  }),
]);

const ConfirmScheduleSchema = z.object({
  sequence: z.array(SequenceStepSchema).min(1),
});

export type ScheduleStepResult = {
  restaurantId: string;
  pickupTime: string; // ISO instant
  mode: "fixed_time" | "immediately_after";
  walkingMinutes?: number;
};

export type ConfirmScheduleResult =
  | { ok: true; groupId: string; steps: ScheduleStepResult[] }
  | { ok: false; error: string; failedRestaurantId?: string };

/**
 * Validates and persists a customer's chosen multi-restaurant pickup
 * sequence (SRS §9: pickup sequence selection, first restaurant gets an
 * explicit time, subsequent restaurants get a fixed time OR "immediately
 * after previous pickup"; SRS §2 walking-time matrix).
 *
 * This function is the ONLY place a pickup schedule gets written. It:
 *   1. Re-derives the cart from the database (never trusts a client-sent
 *      cart snapshot).
 *   2. Confirms every restaurantId in the submitted sequence actually has
 *      items in the customer's current, available cart — the sequence is
 *      an ORDERING choice, not a source of truth for what's being ordered.
 *   3. Resolves each step's absolute pickup time server-side — fixed times
 *      via buildCampusInstant (never trusting a client-computed UTC
 *      timestamp), immediately-after times via the walking-time matrix.
 *   4. Runs checkPickupFeasibility on every resolved time — hours,
 *      capacity, preparation cutoff, pause state.
 *   5. Only on full success, persists multi_order_groups + pickup_sequences.
 *
 * Any single infeasible step aborts the whole confirmation — no partial
 * schedule is ever saved (SRS §9: "System validates restaurant hours,
 * capacity, preparation constraints and feasibility" before commit).
 */
export async function confirmPickupSchedule(input: unknown): Promise<ConfirmScheduleResult> {
  const profile = await requireRole("customer");
  const parsed = ConfirmScheduleSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: "Invalid schedule submission." };
  }

  const cartGroups = await getCurrentCartGrouped();
  const cartRestaurantIds = new Set(cartGroups.filter((g) => g.orderable && g.items.some((i) => i.available)).map((g) => g.restaurantId));

  const { sequence } = parsed.data;

  // Every restaurant in the submitted order must correspond to a real,
  // currently-orderable group in the customer's own cart — and every
  // orderable cart group must be accounted for (no silently dropping a
  // restaurant the customer never chose to remove).
  const submittedIds = sequence.map((s) => s.restaurantId);
  if (new Set(submittedIds).size !== submittedIds.length) {
    return { ok: false, error: "Duplicate restaurant in sequence." };
  }
  for (const id of submittedIds) {
    if (!cartRestaurantIds.has(id)) {
      return { ok: false, error: "One of the selected restaurants is no longer in your cart." };
    }
  }
  for (const id of cartRestaurantIds) {
    if (!submittedIds.includes(id)) {
      return { ok: false, error: "Please include every restaurant currently in your cart." };
    }
  }
  // ConfirmScheduleSchema enforces sequence.min(1), so sequence[0] always exists;
  // zod's .min() doesn't narrow the inferred array type to a non-empty tuple.
  if (sequence[0]!.mode !== "fixed_time") {
    return { ok: false, error: "The first restaurant needs an explicit pickup time." };
  }

  const resolvedSteps: ScheduleStepResult[] = [];
  let previousRestaurantId: string | null = null;
  let previousPickupTime: Date | null = null;

  for (const step of sequence) {
    let pickupTime: Date;
    let walkingMinutes: number | undefined;

    if (step.mode === "fixed_time") {
      pickupTime = buildCampusInstant(step.isoDate, step.time.length === 5 ? `${step.time}:00` : step.time);
    } else {
      if (!previousRestaurantId || !previousPickupTime) {
        return { ok: false, error: "Cannot resolve 'immediately after' without a previous stop." };
      }
      const resolved = await resolveImmediateAfterTime(previousRestaurantId, previousPickupTime, step.restaurantId);
      if ("error" in resolved) {
        return {
          ok: false,
          error: "No walking time is configured between these two restaurants yet.",
          failedRestaurantId: step.restaurantId,
        };
      }
      pickupTime = resolved.pickupTime;
      walkingMinutes = resolved.walkingMinutes;
    }

    const feasibility = await checkPickupFeasibility(step.restaurantId, pickupTime);
    if (!feasibility.feasible) {
      return {
        ok: false,
        error: FEASIBILITY_MESSAGES[feasibility.reason],
        failedRestaurantId: step.restaurantId,
      };
    }

    resolvedSteps.push({
      restaurantId: step.restaurantId,
      pickupTime: pickupTime.toISOString(),
      mode: step.mode,
      walkingMinutes,
    });

    previousRestaurantId = step.restaurantId;
    previousPickupTime = pickupTime;
  }

  // All steps feasible — persist. A fresh group is created on every
  // confirmation rather than attempting to reuse a prior draft; orphaned
  // draft groups (no orders ever created against them) are harmless and
  // are a documented cleanup candidate — see docs/KNOWN_ISSUES.md.
  const supabase = createServiceRoleSupabaseClient();

  const { data: group, error: groupError } = await supabase
    .from("multi_order_groups")
    .insert({ customer_id: profile.id })
    .select("id")
    .single();

  if (groupError || !group) {
    return { ok: false, error: "Could not save your schedule. Please try again." };
  }

  const { error: sequenceError } = await supabase.from("pickup_sequences").insert(
    resolvedSteps.map((s, index) => ({
      group_id: group.id,
      restaurant_id: s.restaurantId,
      sequence_no: index + 1,
      mode: s.mode,
      pickup_time: s.pickupTime,
    }))
  );

  if (sequenceError) {
    return { ok: false, error: "Could not save your schedule. Please try again." };
  }

  return { ok: true, groupId: group.id, steps: resolvedSteps };
}
