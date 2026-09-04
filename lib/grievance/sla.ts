import "server-only";

import type { Json } from "@/types/database";
import { SETTING_KEYS, asRecord, getSetting } from "@/lib/platform/settings";

/**
 * Grievance SLA policy (SRS §13: "First-response and resolution timers;
 * overdue highlighting").
 *
 * The design decision worth recording: SLA due times are computed ONCE, at
 * ticket creation, and stored on the ticket (`first_response_due_at`,
 * `resolution_due_at`) together with a snapshot of the policy that produced
 * them (`sla_policy_snapshot`).
 *
 * The alternative — recomputing from admin_settings on every read — is simpler
 * but wrong in a specific, embarrassing way: an operator who relaxes the urgent
 * SLA from 30 to 120 minutes would retroactively "un-breach" every historical
 * urgent ticket, and the support performance analytics in Phase 9 would silently
 * rewrite themselves. This is the same reasoning as
 * orders.commission_rate_snapshot (SRS §11.5, §23).
 *
 * A consequence to be aware of: changing the policy affects only tickets created
 * afterwards. That is intended, and the settings screen says so.
 */

export type SlaTarget = { firstResponseMinutes: number; resolutionMinutes: number };

/** Mirrors the 0016 seed of admin_settings.grievance_sla_minutes. */
const FALLBACK = {
  urgent: { firstResponseMinutes: 30, resolutionMinutes: 240 },
  high: { firstResponseMinutes: 60, resolutionMinutes: 480 },
  normal: { firstResponseMinutes: 240, resolutionMinutes: 1440 },
  low: { firstResponseMinutes: 480, resolutionMinutes: 4320 },
} satisfies Record<string, SlaTarget>;

export type SlaPolicy = Record<string, SlaTarget>;

/** Reads and normalises the policy. Never throws; falls back to the seed. */
export async function getSlaPolicy(): Promise<SlaPolicy> {
  const raw = asRecord(await getSetting(SETTING_KEYS.grievanceSlaMinutes));
  return normaliseSlaPolicy(raw);
}

export function normaliseSlaPolicy(raw: Record<string, Json> | null | undefined): SlaPolicy {
  const policy: SlaPolicy = { ...FALLBACK };
  if (!raw) return policy;

  for (const priority of Object.keys(FALLBACK) as (keyof typeof FALLBACK)[]) {
    const entry = raw[priority];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, Json>;
    const first = toMinutes(record.first_response);
    const resolution = toMinutes(record.resolution);
    const fallback = FALLBACK[priority];
    policy[priority] = {
      firstResponseMinutes: first ?? fallback.firstResponseMinutes,
      resolutionMinutes: resolution ?? fallback.resolutionMinutes,
    };
  }

  return policy;
}

function toMinutes(value: Json | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

export type SlaDueTimes = {
  firstResponseDueAt: string;
  resolutionDueAt: string;
  snapshot: Json;
};

/**
 * Computes the due instants for a new ticket. Called by every ticket-creation
 * path: the customer "Report an issue" shortcut (§I), the vendor grievance form
 * (Phase 6), and admin-created tickets.
 */
export function computeSlaDueTimes(
  priority: string,
  policy: SlaPolicy,
  createdAt: Date = new Date()
): SlaDueTimes {
  const target = policy[priority] ?? FALLBACK.normal;
  const base = createdAt.getTime();

  return {
    firstResponseDueAt: new Date(base + target.firstResponseMinutes * 60_000).toISOString(),
    resolutionDueAt: new Date(base + target.resolutionMinutes * 60_000).toISOString(),
    // Stored so a later policy change cannot rewrite this ticket's history.
    snapshot: {
      priority,
      first_response_minutes: target.firstResponseMinutes,
      resolution_minutes: target.resolutionMinutes,
      captured_at: createdAt.toISOString(),
    } as unknown as Json,
  };
}

export type SlaState = {
  /** Has the first-response clock been stopped by an actual reply? */
  firstResponseMet: boolean;
  firstResponseBreached: boolean;
  firstResponseDueAt: string | null;
  resolutionMet: boolean;
  resolutionBreached: boolean;
  resolutionDueAt: string | null;
  /** Minutes remaining on the tightest live clock; negative when overdue. */
  minutesRemaining: number | null;
  /** Any breach at all — drives the §13 "overdue highlighting". */
  breached: boolean;
};

/**
 * Evaluates a ticket against its own stored due times.
 *
 * Note the asymmetry, which is intentional and matches how support SLAs
 * actually work: a clock that was met stays met even if the ticket later drags
 * on (`first_response_at <= first_response_due_at` is a permanent fact), while
 * an unmet clock keeps accruing against `now`. And a resolved ticket is judged
 * on `resolved_at`, not on how long it stayed in the closed state afterwards.
 */
export function evaluateSla(
  ticket: {
    status: string;
    firstResponseAt: string | null;
    firstResponseDueAt: string | null;
    resolvedAt: string | null;
    resolutionDueAt: string | null;
  },
  now: Date = new Date()
): SlaState {
  const nowMs = now.getTime();

  const frDue = ticket.firstResponseDueAt ? new Date(ticket.firstResponseDueAt).getTime() : null;
  const frAt = ticket.firstResponseAt ? new Date(ticket.firstResponseAt).getTime() : null;
  const firstResponseMet = frAt !== null && (frDue === null || frAt <= frDue);
  const firstResponseBreached =
    frDue !== null && (frAt === null ? nowMs > frDue : frAt > frDue);

  const resDue = ticket.resolutionDueAt ? new Date(ticket.resolutionDueAt).getTime() : null;
  const resAt = ticket.resolvedAt ? new Date(ticket.resolvedAt).getTime() : null;
  const resolutionMet = resAt !== null && (resDue === null || resAt <= resDue);
  const resolutionBreached = resDue !== null && (resAt === null ? nowMs > resDue : resAt > resDue);

  // The clock a support agent should watch: first response if it is still open,
  // otherwise resolution. Terminal tickets have no live clock.
  let minutesRemaining: number | null = null;
  const terminal = ticket.status === "resolved" || ticket.status === "closed";
  if (!terminal) {
    const liveDue = frAt === null ? frDue : resDue;
    if (liveDue !== null) minutesRemaining = Math.round((liveDue - nowMs) / 60_000);
  }

  return {
    firstResponseMet,
    firstResponseBreached,
    firstResponseDueAt: ticket.firstResponseDueAt,
    resolutionMet,
    resolutionBreached,
    resolutionDueAt: ticket.resolutionDueAt,
    minutesRemaining,
    breached: firstResponseBreached || resolutionBreached,
  };
}

/** Human label for a live clock, e.g. "2h 10m left" / "45m overdue". */
export function formatSlaRemaining(minutesRemaining: number | null): string | null {
  if (minutesRemaining === null) return null;
  const overdue = minutesRemaining < 0;
  const total = Math.abs(minutesRemaining);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const parts = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return overdue ? `${parts} overdue` : `${parts} left`;
}
