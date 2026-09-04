import { toCampusTime, CAMPUS_TIMEZONE } from "@/lib/scheduling/timezone";

/**
 * Display formatting for the admin console.
 *
 * Every timestamp an operator reads is rendered in CAMPUS time, never in the
 * browser's timezone and never in raw UTC. That matters more here than it looks:
 * live operations decisions ("is this order overdue?") are made against the
 * clock on the wall of the canteen, and an admin travelling — or a server
 * deployed in another region — must not see a different set of overdue orders
 * than the staff standing at the counter.
 *
 * These are pure string functions with no `server-only` marker so that a client
 * island (the alert acknowledgement row, a countdown) can format the same way a
 * server page does. Formatting is done from the fixed-offset helpers in
 * lib/scheduling/timezone.ts rather than `Intl` with a timeZone option, for the
 * same reason recorded there: one auditable offset, identical on server and
 * client, with no dependency on the runtime's ICU data being complete.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "14:05" — campus local. Used in dense operational tables. */
export function fmtTime(iso: string | null | undefined): string {
  const date = parse(iso);
  if (!date) return "—";
  const zoned = toCampusTime(date);
  return `${String(zoned.getUTCHours()).padStart(2, "0")}:${String(zoned.getUTCMinutes()).padStart(2, "0")}`;
}

/** "30 Aug" — campus local, no year. For rows all inside the current season. */
export function fmtDate(iso: string | null | undefined): string {
  const date = parse(iso);
  if (!date) return "—";
  const zoned = toCampusTime(date);
  return `${zoned.getUTCDate()} ${MONTHS[zoned.getUTCMonth()]}`;
}

/** "30 Aug 2026, 14:05" — the unambiguous form, for detail pages and audit rows. */
export function fmtDateTime(iso: string | null | undefined): string {
  const date = parse(iso);
  if (!date) return "—";
  const zoned = toCampusTime(date);
  return `${zoned.getUTCDate()} ${MONTHS[zoned.getUTCMonth()]} ${zoned.getUTCFullYear()}, ${fmtTime(iso)}`;
}

/** Appended where a reader might otherwise assume their own timezone. */
export const TIMEZONE_NOTE = `All times ${CAMPUS_TIMEZONE}`;

/**
 * Signed minute difference from now, positive in the future.
 *
 * Returned as a number rather than a string so callers can both label it AND
 * branch on it (an order 40 minutes past pickup is a different alert tone from
 * one 2 minutes past).
 */
export function minutesFromNow(iso: string | null | undefined, now: Date = new Date()): number | null {
  const date = parse(iso);
  if (!date) return null;
  return Math.round((date.getTime() - now.getTime()) / 60_000);
}

/**
 * "in 25m" / "12m ago" / "in 2h 05m".
 *
 * Deliberately not "just now"/"a moment ago": operational alerts are read as
 * instructions, and vagueness about a five-minute window is the difference
 * between a hot order and a cold one.
 */
export function fmtRelative(iso: string | null | undefined, now: Date = new Date()): string {
  const minutes = minutesFromNow(iso, now);
  if (minutes === null) return "—";
  const future = minutes > 0;
  const total = Math.abs(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  const span = hours > 0 ? `${hours}h ${String(rest).padStart(2, "0")}m` : `${rest}m`;
  if (total === 0) return "now";
  return future ? `in ${span}` : `${span} ago`;
}

/** "2h 05m" / "18m" — an elapsed duration with no direction implied. */
export function fmtDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "—";
  const total = Math.abs(Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return hours > 0 ? `${hours}h ${String(rest).padStart(2, "0")}m` : `${rest}m`;
}

/**
 * A rate stored as numeric(6,4) (0.0800) shown as a percentage ("8%").
 *
 * Trailing zeros are trimmed so the launch commission reads "8%" rather than
 * "8.00%", but a genuinely fractional rate keeps its precision — 0.0825 shows
 * as "8.25%", never rounded to 8%, because the figure is used to check a
 * financial calculation (SRS §11.5).
 */
export function fmtRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "—";
  const percent = rate * 100;
  const rounded = Math.round(percent * 100) / 100;
  return `${rounded}%`;
}

/** Compact count for KPI tiles: 1234 → "1,234". */
export function fmtCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-IN");
}

/**
 * enum_value → "Enum value". Used for order status, grievance category and the
 * other snake_case enums, so no page needs its own switch just to render a
 * label. Where the SRS specifies exact wording (order status in the customer
 * app, for instance), that wording lives with the feature, not here.
 */
export function humanise(value: string | null | undefined): string {
  if (!value) return "—";
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** First 8 characters of a uuid, for dense tables. Full id stays in the link. */
export function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  return id.slice(0, 8);
}
