/**
 * UNI8 operates on a single campus, in a single timezone. Every
 * time-of-day comparison (restaurant hours, pickup slot bucketing,
 * "today" for exception-date lookups) must happen in THIS timezone, not
 * the server's local time or a naive UTC read of a timestamp — otherwise
 * "closes at 22:00" silently means something different depending on where
 * the Next.js server happens to be deployed.
 *
 * IMPLEMENTATION NOTE: this uses hand-rolled FIXED-OFFSET arithmetic
 * (+05:30, India Standard Time, which has no DST) rather than an IANA
 * timezone library call. That's a deliberate choice made because this
 * code was authored in a sandboxed environment with no network access to
 * install/verify date-fns-tz's exact runtime behavior — a silently wrong
 * timezone conversion in pickup scheduling is worse than a simple,
 * auditable-by-hand offset calculation. If UNI8 ever expands beyond IST
 * (a different campus, DST-observing timezone), replace the two
 * conversion functions below with a verified library call — the rest of
 * the codebase only depends on this module's exported functions, not on
 * how they're implemented. Tracked in docs/KNOWN_ISSUES.md.
 */
export const CAMPUS_TIMEZONE = "Asia/Kolkata";
const CAMPUS_UTC_OFFSET_MINUTES = 5 * 60 + 30; // IST = UTC+05:30, no DST

/**
 * Absolute UTC instant → a Date whose UTC-* getters (getUTCFullYear,
 * getUTCHours, etc.) read as the campus-local wall-clock value. This is
 * the standard "fake UTC to carry zoned fields" trick — callers should
 * only ever read this result's UTC getters, never local getters
 * (getHours() etc., which would reapply the server's own timezone).
 */
export function toCampusTime(utcDate: Date): Date {
  return new Date(utcDate.getTime() + CAMPUS_UTC_OFFSET_MINUTES * 60_000);
}

/**
 * The inverse: given a Date whose UTC-* getters represent the intended
 * campus-local wall-clock time, returns the real absolute UTC instant.
 */
export function fromCampusTime(localWallClock: Date): Date {
  return new Date(localWallClock.getTime() - CAMPUS_UTC_OFFSET_MINUTES * 60_000);
}

/** Campus-local "YYYY-MM-DD" for a given UTC instant — for exception-date lookups. */
export function campusIsoDate(utcDate: Date): string {
  const zoned = toCampusTime(utcDate);
  const y = zoned.getUTCFullYear();
  const m = String(zoned.getUTCMonth() + 1).padStart(2, "0");
  const d = String(zoned.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Campus-local "HH:mm:ss" for a given UTC instant — for comparing against restaurant_hours. */
export function campusTimeOfDay(utcDate: Date): string {
  const zoned = toCampusTime(utcDate);
  const h = String(zoned.getUTCHours()).padStart(2, "0");
  const m = String(zoned.getUTCMinutes()).padStart(2, "0");
  const s = String(zoned.getUTCSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/** Campus-local day-of-week (0 = Sunday) for a given UTC instant. */
export function campusDayOfWeek(utcDate: Date): number {
  return toCampusTime(utcDate).getUTCDay();
}

/**
 * Builds the absolute UTC instant for a specific campus-local calendar
 * date + "HH:mm:ss" time-of-day — e.g. combining a date picker value with
 * a chosen slot start. This is the inverse of campusIsoDate/campusTimeOfDay
 * combined.
 */
export function buildCampusInstant(isoDate: string, hhmmss: string): Date {
  // Callers are expected to pass "YYYY-MM-DD" and "HH:mm:ss" (validated at the
  // Zod boundary before reaching this function), so both splits always yield
  // the expected number of numeric parts.
  const [y, mo, d] = isoDate.split("-").map(Number) as [number, number, number];
  const [h, mi, s] = hhmmss.split(":").map(Number) as [number, number, number | undefined];
  const naiveUtc = new Date(Date.UTC(y, mo - 1, d, h, mi, s ?? 0));
  return fromCampusTime(naiveUtc);
}
