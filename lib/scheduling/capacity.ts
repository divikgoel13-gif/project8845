import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { campusIsoDate, campusDayOfWeek, campusTimeOfDay, buildCampusInstant } from "@/lib/scheduling/timezone";

/**
 * Buckets an absolute pickup time down to the start of its capacity slot,
 * e.g. with a 15-minute interval, 13:07 → 13:00, 13:22 → 13:15. Bucketing
 * happens in campus-local wall-clock time so a restaurant's "8 orders per
 * 15 minutes" reads the way its owner actually thinks about it.
 */
export function bucketToSlotStart(time: Date, intervalMinutes: number): string {
  const hhmmss = campusTimeOfDay(time); // "HH:MM:SS"
  const totalMinutes = parseInt(hhmmss.slice(0, 2), 10) * 60 + parseInt(hhmmss.slice(3, 5), 10);
  const bucketMinutes = Math.floor(totalMinutes / intervalMinutes) * intervalMinutes;
  const hh = String(Math.floor(bucketMinutes / 60)).padStart(2, "0");
  const mm = String(bucketMinutes % 60).padStart(2, "0");
  return `${hh}:${mm}:00`;
}

/**
 * Resolves the capacity for the pickup slot containing `time` — checking a
 * specific-date override first, then a recurring day-of-week override,
 * then falling back to restaurants.default_slot_capacity (SRS §2 Pickup-
 * slot capacity).
 */
export async function resolveSlotCapacity(restaurantId: string, time: Date): Promise<number> {
  const supabase = createServiceRoleSupabaseClient();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("pickup_slot_interval_minutes, default_slot_capacity")
    .eq("id", restaurantId)
    .single();

  if (!restaurant) return 0;

  const slotStart = bucketToSlotStart(time, restaurant.pickup_slot_interval_minutes);
  const isoDate = campusIsoDate(time);
  const dayOfWeek = campusDayOfWeek(time);

  const { data: specificOverride } = await supabase
    .from("pickup_capacity_overrides")
    .select("capacity")
    .eq("restaurant_id", restaurantId)
    .eq("specific_date", isoDate)
    .eq("slot_start", slotStart)
    .maybeSingle();

  if (specificOverride) return specificOverride.capacity;

  const { data: recurringOverride } = await supabase
    .from("pickup_capacity_overrides")
    .select("capacity")
    .eq("restaurant_id", restaurantId)
    .eq("day_of_week", dayOfWeek)
    .eq("slot_start", slotStart)
    .maybeSingle();

  if (recurringOverride) return recurringOverride.capacity;

  return restaurant.default_slot_capacity;
}

/**
 * Counts orders already occupying the pickup slot containing `time`.
 * Cancelled/refunded/no_show orders don't count against capacity — they
 * freed the slot. `payment_pending` orders ALSO don't count (added in
 * Phase 3, see 0011_order_state_machine_trigger.sql's index comment) —
 * an order only really consumes a slot once payment is actually
 * confirmed (status 'paid' or later); otherwise an abandoned Razorpay
 * checkout would permanently block a slot nobody ever paid for.
 * NOTE (Phase 2 scope, still true in Phase 3): this counts confirmed
 * `orders` rows only, not other customers' in-progress draft schedules
 * (pickup_sequences without an order yet) — a slot is not "held" during
 * scheduling, only consumed at payment/order-creation time. Under real
 * concurrent load this means two customers could both be told a slot is
 * available and then race for the last spot at checkout — Phase 3's
 * `lib/actions/customer/checkout.ts#initiateRazorpayCheckout` re-checks
 * feasibility again immediately before creating the `orders` rows, and
 * `lib/orders/finalize-payment.ts` checks once more before honoring a
 * captured payment — but a payment already captured is always honored
 * even if the slot filled in the meantime (SRS V1 has no automated
 * refund path — see that file's own comment).
 */
export async function countOrdersInSlot(restaurantId: string, time: Date): Promise<number> {
  const supabase = createServiceRoleSupabaseClient();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("pickup_slot_interval_minutes")
    .eq("id", restaurantId)
    .single();

  if (!restaurant) return 0;

  const slotStart = bucketToSlotStart(time, restaurant.pickup_slot_interval_minutes);
  const isoDate = campusIsoDate(time);
  // buildCampusInstant correctly converts the campus-local "date + slot
  // start time" back to an absolute UTC instant — see lib/scheduling/timezone.ts.
  // (A prior version of this function used Date#setUTCHours directly on
  // `time`, which is wrong whenever the server isn't itself in IST — fixed
  // during Phase 2 review before it shipped.)
  const slotStartTime = buildCampusInstant(isoDate, slotStart);
  const slotEndTime = new Date(slotStartTime.getTime() + restaurant.pickup_slot_interval_minutes * 60_000);

  const { count } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId)
    .not("status", "in", "(payment_pending,cancelled,refunded,no_show)")
    .gte("pickup_time", slotStartTime.toISOString())
    .lt("pickup_time", slotEndTime.toISOString());

  return count ?? 0;
}

export async function remainingCapacity(restaurantId: string, time: Date): Promise<number> {
  const [capacity, occupied] = await Promise.all([
    resolveSlotCapacity(restaurantId, time),
    countOrdersInSlot(restaurantId, time),
  ]);
  return Math.max(0, capacity - occupied);
}
