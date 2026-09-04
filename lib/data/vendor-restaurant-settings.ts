import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { RestaurantStatus } from "@/lib/restaurants/status";

export type RestaurantOperationsSettings = {
  /**
   * All four V2.6 §60 states. A vendor admin cannot SET 'closed' or 'archived'
   * — those are Super Admin decisions (§32 ownership table) — but must be able
   * to see one, because a vendor whose restaurant a super admin has closed
   * needs the settings page to explain why the pause controls do nothing.
   */
  status: RestaurantStatus;
  pausedUntil: string | null;
  pausedReason: string | null;
  closedReason: string | null;
  preparationDefaultMinutes: number;
  gracePeriodMinutes: number;
  pickupSlotIntervalMinutes: number;
  defaultSlotCapacity: number;
  hours: { dayOfWeek: number; isClosed: boolean; opensAt: string | null; closesAt: string | null }[];
  exceptions: {
    id: string;
    exceptionDate: string;
    isClosed: boolean;
    opensAt: string | null;
    closesAt: string | null;
    note: string | null;
  }[];
  capacityOverrides: {
    id: string;
    dayOfWeek: number | null;
    specificDate: string | null;
    slotStart: string;
    capacity: number;
  }[];
};

/**
 * Everything the Vendor Admin Settings page (SRS Phase 5) needs to
 * render the current state of every control it writes through
 * lib/actions/vendor/restaurant-settings.ts.
 */
export async function getRestaurantOperationsSettings(restaurantId: string): Promise<RestaurantOperationsSettings | null> {
  const supabase = createServerSupabaseClient();

  const [{ data: restaurant }, { data: hours }, { data: exceptions }, { data: overrides }] = await Promise.all([
    supabase
      .from("restaurants")
      .select(
        "status, paused_until, paused_reason, closed_reason, preparation_default_minutes, grace_period_minutes, pickup_slot_interval_minutes, default_slot_capacity"
      )
      .eq("id", restaurantId)
      .single(),
    supabase
      .from("restaurant_hours")
      .select("day_of_week, is_closed, opens_at, closes_at")
      .eq("restaurant_id", restaurantId)
      .order("day_of_week"),
    supabase
      .from("restaurant_hour_exceptions")
      .select("id, exception_date, is_closed, opens_at, closes_at, note")
      .eq("restaurant_id", restaurantId)
      .gte("exception_date", new Date().toISOString().slice(0, 10))
      .order("exception_date"),
    supabase
      .from("pickup_capacity_overrides")
      .select("id, day_of_week, specific_date, slot_start, capacity")
      .eq("restaurant_id", restaurantId)
      .order("slot_start"),
  ]);

  if (!restaurant) return null;

  return {
    status: restaurant.status,
    pausedUntil: restaurant.paused_until,
    pausedReason: restaurant.paused_reason,
    closedReason: restaurant.closed_reason,
    preparationDefaultMinutes: restaurant.preparation_default_minutes,
    gracePeriodMinutes: restaurant.grace_period_minutes,
    pickupSlotIntervalMinutes: restaurant.pickup_slot_interval_minutes,
    defaultSlotCapacity: restaurant.default_slot_capacity,
    hours: (hours ?? []).map((h) => ({
      dayOfWeek: h.day_of_week,
      isClosed: h.is_closed,
      opensAt: h.opens_at,
      closesAt: h.closes_at,
    })),
    exceptions: (exceptions ?? []).map((e) => ({
      id: e.id,
      exceptionDate: e.exception_date,
      isClosed: e.is_closed,
      opensAt: e.opens_at,
      closesAt: e.closes_at,
      note: e.note,
    })),
    capacityOverrides: (overrides ?? []).map((o) => ({
      id: o.id,
      dayOfWeek: o.day_of_week,
      specificDate: o.specific_date,
      slotStart: o.slot_start,
      capacity: o.capacity,
    })),
  };
}
