import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  restaurantOperationalState,
  restaurantStateLabel,
  type RestaurantLocationType,
  type RestaurantStatus,
} from "@/lib/restaurants/status";

/**
 * Restaurant workspace context (SRS §5.3).
 *
 * §5.3 says the restaurant workspace "must permanently show which restaurant is
 * being managed". That single sentence is the reason this module exists rather
 * than each of the fourteen workspace pages fetching the restaurant itself:
 *
 *  - the header is rendered once, by the workspace layout, from
 *    `getRestaurantContext`, so it cannot be forgotten on page eleven;
 *  - the layout is also the natural place to 404 on an unknown id, so no page
 *    has to defend against a null restaurant.
 *
 * Archived restaurants ARE returned. A super admin must be able to open an
 * archived restaurant to read its history — §P forbids deleting operational
 * history, and hiding the workspace would make the archive unreadable. The
 * status is surfaced in the header instead, and write actions guard themselves.
 *
 * This uses the RLS-bound client: `restaurants_select_*` already lets a super
 * admin see every row, so there is nothing to bypass. A vendor admin reaching
 * these routes is stopped earlier by middleware plus `requireSuperAdmin`.
 *
 * The state helpers used to live in this file. They moved to
 * `lib/restaurants/status.ts` when V2.6 §60 added the fourth 'closed' state,
 * because the customer and vendor readers need the same four-state vocabulary
 * and must not each maintain their own copy. They are re-exported here so the
 * fourteen workspace pages keep a single import.
 */

export {
  restaurantOperationalState,
  restaurantStateLabel,
  type RestaurantOperationalState,
} from "@/lib/restaurants/status";

export type RestaurantContext = {
  id: string;
  name: string;
  slug: string;
  status: RestaurantStatus;
  location: string | null;
  description: string | null;
  logoPath: string | null;
  pausedUntil: string | null;
  pausedReason: string | null;
  closedAt: string | null;
  closedReason: string | null;
  /** SRS V2.6 §29.1 — required classification, drives the §29.2 customer popup. */
  locationType: RestaurantLocationType;
  universityPlaceName: string | null;
  preparationDefaultMinutes: number;
  gracePeriodMinutes: number;
  pickupSlotIntervalMinutes: number;
  defaultSlotCapacity: number;
  createdAt: string;
  archivedAt: string | null;
  statusChangedAt: string | null;
};

export async function getRestaurantContext(restaurantId: string): Promise<RestaurantContext | null> {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("restaurants")
    .select(
      `id, name, slug, status, location, description, logo_path, paused_until, paused_reason,
       closed_at, closed_reason, location_type, university_place_name,
       preparation_default_minutes, grace_period_minutes, pickup_slot_interval_minutes,
       default_slot_capacity, created_at, archived_at, status_changed_at`
    )
    .eq("id", restaurantId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    status: data.status,
    location: data.location,
    description: data.description,
    logoPath: data.logo_path,
    pausedUntil: data.paused_until,
    pausedReason: data.paused_reason,
    closedAt: data.closed_at,
    closedReason: data.closed_reason,
    locationType: data.location_type,
    universityPlaceName: data.university_place_name,
    preparationDefaultMinutes: data.preparation_default_minutes,
    gracePeriodMinutes: data.grace_period_minutes,
    pickupSlotIntervalMinutes: data.pickup_slot_interval_minutes,
    defaultSlotCapacity: data.default_slot_capacity,
    createdAt: data.created_at,
    archivedAt: data.archived_at,
    statusChangedAt: data.status_changed_at,
  };
}

/**
 * The one-line status summary the §5.3 header shows, reason included. A header
 * that says only "Paused" makes an operator open Settings to find out why;
 * §5.3 asks the header to carry the restaurant's identity and state, and the
 * reason is the operationally useful half of the state.
 */
export function restaurantStateSummary(r: RestaurantContext, now: Date = new Date()): string {
  const state = restaurantOperationalState(r, now);
  const label = restaurantStateLabel(state);
  const reason =
    state === "closed"
      ? r.closedReason
      : state === "paused" || state === "paused-until"
        ? r.pausedReason
        : null;
  return reason?.trim() ? `${label} — ${reason.trim()}` : label;
}

/**
 * The fourteen §5.3 workspace pages, in the SRS's own groups and order:
 * OVERVIEW, OPERATIONS, PEOPLE & ACCESS, FINANCE, CUSTOMER EXPERIENCE,
 * CONFIGURATION, SYSTEM. The group names are transcribed rather than chosen —
 * §5.3 is a table, and renaming its rows would make the built IA impossible to
 * check against the spec.
 *
 * Kept here rather than in the workspace layout because the same groups drive
 * the workspace dashboard's section links, and two copies would drift.
 */
export function restaurantWorkspaceNav(restaurantId: string) {
  const base = `/admin/restaurants/${restaurantId}`;
  return [
    {
      group: "OVERVIEW",
      items: [{ label: "Dashboard", href: `${base}/dashboard` }],
    },
    {
      group: "OPERATIONS",
      items: [
        { label: "Orders", href: `${base}/orders` },
        { label: "Products", href: `${base}/products` },
        { label: "Menu & Categories", href: `${base}/menu` },
        { label: "Pickup & Capacity", href: `${base}/pickup` },
      ],
    },
    {
      group: "PEOPLE & ACCESS",
      items: [
        { label: "Vendor Admins", href: `${base}/vendor-admins` },
        { label: "Staff", href: `${base}/staff` },
      ],
    },
    {
      group: "FINANCE",
      items: [
        { label: "Payments", href: `${base}/payments` },
        { label: "Disbursements", href: `${base}/disbursements` },
      ],
    },
    {
      group: "CUSTOMER EXPERIENCE",
      items: [
        { label: "Grievances", href: `${base}/grievances` },
        { label: "Ratings", href: `${base}/ratings` },
      ],
    },
    {
      group: "CONFIGURATION",
      items: [
        { label: "Restaurant Settings", href: `${base}/settings` },
        { label: "Walking Times", href: `${base}/walking-times` },
      ],
    },
    {
      group: "SYSTEM",
      items: [{ label: "Audit Log", href: `${base}/audit` }],
    },
  ];
}
