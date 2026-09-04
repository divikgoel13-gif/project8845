import type { SettingKey } from "@/lib/platform/settings";
import type { Json } from "@/types/database";

/**
 * Key strings are duplicated here rather than imported from
 * `lib/platform/settings.ts`'s `SETTING_KEYS` runtime object: that module
 * starts with `import "server-only"`, and this file is imported by BOTH the
 * server page and the client form (`settings-forms.tsx`) — pulling in a
 * server-only module's runtime code from a client bundle fails the build.
 * Only the TYPE `SettingKey` is imported (types are erased before bundling,
 * so they carry no such restriction); the string literals below are the
 * same values `SETTING_KEYS` holds and must be kept in sync with it by hand.
 */
const KEYS = {
  restaurantCancellationPenaltyRate: "restaurant_cancellation_penalty_rate",
  autoReadyGraceMinutes: "auto_ready_grace_minutes",
  defaultGracePeriodMinutes: "default_grace_period_minutes",
  defaultPreparationMinutes: "default_preparation_minutes",
  defaultSlotIntervalMinutes: "default_slot_interval_minutes",
  defaultSlotCapacity: "default_slot_capacity",
  grievanceSlaMinutes: "grievance_sla_minutes",
  customerFlagThresholds: "customer_flag_thresholds",
  liveOpsThresholds: "live_ops_thresholds",
} as const satisfies Record<string, SettingKey>;

/**
 * Declarative field lists for the Settings page (Phase 9, SRS §23). Ten keys
 * live in `admin_settings`; seven are a single number and three are small
 * objects with known sub-fields (see `lib/actions/admin/settings.ts`'s
 * `OBJECT_SHAPES`, which validates against this exact same set of paths —
 * kept in one file, imported by both the server page and the client form, so
 * the two can never drift apart into "the form has a field the validator
 * doesn't expect" or vice versa).
 *
 * `path: null` means the setting's whole value IS the number (e.g.
 * `default_slot_capacity`); a string path reads/writes that key inside the
 * object (e.g. `grievance_sla_minutes.urgent.first_response`).
 */

export type SettingField = {
  path: string | null;
  label: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
};

export type SettingSpec = {
  key: SettingKey;
  title: string;
  description: string;
  fields: SettingField[];
};

export const SETTING_SPECS: SettingSpec[] = [
  {
    key: KEYS.restaurantCancellationPenaltyRate,
    title: "Restaurant cancellation penalty",
    description: "Fraction of order value forfeited when a restaurant cancels a paid order (SRS §12).",
    fields: [{ path: null, label: "Penalty rate", hint: "e.g. 0.49 = 49%", min: 0, max: 1, step: 0.01 }],
  },
  {
    key: KEYS.autoReadyGraceMinutes,
    title: "Auto-ready grace period",
    description: "Minutes after the promised time before an unmarked order is auto-flagged ready.",
    fields: [{ path: null, label: "Minutes", min: 1, step: 1 }],
  },
  {
    key: KEYS.defaultGracePeriodMinutes,
    title: "Default pickup grace period",
    description: "Starting grace-period default for newly created restaurants. Existing restaurants keep their own value.",
    fields: [{ path: null, label: "Minutes", min: 1, step: 1 }],
  },
  {
    key: KEYS.defaultPreparationMinutes,
    title: "Default preparation time",
    description: "Starting preparation-time default for newly created restaurants. Existing restaurants keep their own value.",
    fields: [{ path: null, label: "Minutes", min: 1, step: 1 }],
  },
  {
    key: KEYS.defaultSlotIntervalMinutes,
    title: "Default pickup slot interval",
    description: "Starting slot-interval default for newly created restaurants.",
    fields: [{ path: null, label: "Minutes", min: 1, step: 1 }],
  },
  {
    key: KEYS.defaultSlotCapacity,
    title: "Default slot capacity",
    description: "Starting per-slot order capacity for newly created restaurants.",
    fields: [{ path: null, label: "Orders per slot", min: 1, step: 1 }],
  },
  {
    key: KEYS.grievanceSlaMinutes,
    title: "Grievance SLA (minutes)",
    description: "First-response and resolution targets per priority (SRS §13). Snapshotted onto each ticket at creation — changing this never retroactively alters an open ticket's own SLA.",
    fields: [
      { path: "urgent.first_response", label: "Urgent — first response", min: 1, step: 1 },
      { path: "urgent.resolution", label: "Urgent — resolution", min: 1, step: 1 },
      { path: "high.first_response", label: "High — first response", min: 1, step: 1 },
      { path: "high.resolution", label: "High — resolution", min: 1, step: 1 },
      { path: "normal.first_response", label: "Normal — first response", min: 1, step: 1 },
      { path: "normal.resolution", label: "Normal — resolution", min: 1, step: 1 },
      { path: "low.first_response", label: "Low — first response", min: 1, step: 1 },
      { path: "low.resolution", label: "Low — resolution", min: 1, step: 1 },
    ],
  },
  {
    key: KEYS.customerFlagThresholds,
    title: "Customer 360 flag thresholds",
    description: "Thresholds behind the data-driven customer flags (SRS §7.3).",
    fields: [
      { path: "high_value_lifetime_paise", label: "High value — lifetime spend (paise)", min: 0, step: 100 },
      { path: "frequent_customer_orders", label: "Frequent customer — order count", min: 1, step: 1 },
      { path: "repeated_no_shows", label: "Repeated no-shows — count", min: 1, step: 1 },
      { path: "frequent_cancellations", label: "Frequent cancellations — count", min: 1, step: 1 },
      { path: "lookback_days", label: "Lookback window (days)", min: 1, step: 1 },
    ],
  },
  {
    key: KEYS.liveOpsThresholds,
    title: "Live Operations thresholds",
    description: "Windows and ratios used by the Live Operations Command Center (SRS V2 §F).",
    fields: [
      { path: "due_soon_minutes", label: "Due-soon window (minutes)", min: 1, step: 1 },
      { path: "not_started_minutes_before_pickup", label: "Not-started window before pickup (minutes)", min: 1, step: 1 },
      { path: "ready_overdue_minutes", label: "Ready-overdue threshold (minutes)", min: 1, step: 1 },
      { path: "pickup_overdue_minutes", label: "Pickup-overdue threshold (minutes)", min: 1, step: 1 },
      { path: "capacity_warning_ratio", label: "Capacity warning ratio", hint: "e.g. 0.8 = 80% full", min: 0, max: 1, step: 0.05 },
    ],
  },
];

/** Reads a dotted path (e.g. "urgent.first_response") out of a Json value. */
function readPath(value: Json | null | undefined, path: string): number {
  const parts = path.split(".");
  let current: unknown = value;
  for (const part of parts) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return 0;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "number" ? current : 0;
}

/** Flattens a setting's stored value into `{ path: number }` for form initial state. */
export function extractFieldValues(value: Json | null | undefined, fields: SettingField[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const field of fields) {
    const key = field.path ?? "_scalar";
    result[key] = field.path === null ? (typeof value === "number" ? value : 0) : readPath(value, field.path);
  }
  return result;
}

/** Rebuilds the Json value to submit from flat form state. */
export function buildSettingValue(fields: SettingField[], values: Record<string, number>): Json {
  // fields.length === 1 guarantees fields[0] exists.
  if (fields.length === 1 && fields[0]!.path === null) {
    return values._scalar ?? 0;
  }
  const result: Record<string, Json> = {};
  for (const field of fields) {
    if (!field.path) continue;
    const parts = field.path.split(".");
    let cursor = result;
    for (let i = 0; i < parts.length - 1; i += 1) {
      // i < parts.length - 1 guarantees parts[i] exists.
      const part = parts[i]!;
      if (typeof cursor[part] !== "object" || cursor[part] === null) cursor[part] = {};
      cursor = cursor[part] as Record<string, Json>;
    }
    // parts comes from a non-empty path.split("."), so the last element always exists.
    cursor[parts[parts.length - 1]!] = values[field.path] ?? 0;
  }
  return result;
}
