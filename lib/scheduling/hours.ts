import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { campusIsoDate, campusDayOfWeek, campusTimeOfDay } from "@/lib/scheduling/timezone";

export type OpenWindow = { opensAt: string; closesAt: string } | null; // "HH:MM:SS" campus-local, or null if closed

/**
 * Resolves whether a restaurant is open on the campus-local calendar date
 * containing `time`, and if so, its opening/closing time — checking
 * restaurant_hour_exceptions FIRST (a specific date always overrides the
 * recurring weekly schedule), then falling back to restaurant_hours for
 * that day of week (SRS §9 Discovery: "View restaurant status, hours,
 * pickup availability").
 *
 * All day/time resolution happens in CAMPUS_TIMEZONE (see
 * lib/scheduling/timezone.ts) — never the server's local time.
 *
 * Returns null if the restaurant is closed that day.
 */
export async function resolveOpenWindow(restaurantId: string, time: Date): Promise<OpenWindow> {
  const supabase = createServiceRoleSupabaseClient();
  const isoDate = campusIsoDate(time);
  const dayOfWeek = campusDayOfWeek(time);

  const { data: exception } = await supabase
    .from("restaurant_hour_exceptions")
    .select("is_closed, opens_at, closes_at")
    .eq("restaurant_id", restaurantId)
    .eq("exception_date", isoDate)
    .maybeSingle();

  if (exception) {
    if (exception.is_closed || !exception.opens_at || !exception.closes_at) return null;
    return { opensAt: exception.opens_at, closesAt: exception.closes_at };
  }

  const { data: recurring } = await supabase
    .from("restaurant_hours")
    .select("is_closed, opens_at, closes_at")
    .eq("restaurant_id", restaurantId)
    .eq("day_of_week", dayOfWeek)
    .maybeSingle();

  if (!recurring || recurring.is_closed || !recurring.opens_at || !recurring.closes_at) return null;

  return { opensAt: recurring.opens_at, closesAt: recurring.closes_at };
}

/** True if `time` falls within the resolved open window, compared in campus-local time. */
export function isWithinWindow(time: Date, window: OpenWindow): boolean {
  if (!window) return false;
  const hhmmss = campusTimeOfDay(time);
  return hhmmss >= window.opensAt && hhmmss <= window.closesAt;
}
