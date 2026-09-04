import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

/**
 * In-app notification dispatch (SRS V2.6 §63).
 *
 * §63 replaces the V1 SMS layer with in-app delivery, and the shape of the row
 * changes with it: `notifications` still records that a user was told
 * something, but now also records WHAT they were told (`title`/`body`), WHERE
 * it points (`link_path`), WHAT it is about (`order_id`,
 * `grievance_ticket_id`, `restaurant_id`) and WHETHER they have seen it
 * (`read_at`). This module is the only sanctioned writer of those columns.
 *
 * Three decisions worth stating, because they are the ones a future change is
 * most likely to undo by accident:
 *
 *  1. Copy is SNAPSHOTTED, never re-derived. We resolve the template at send
 *     time and store the rendered strings on the row — the same rule as
 *     `order_items.name_snapshot` and `commission_rate_snapshot`. An operator
 *     editing `notification_templates` in /admin/settings must change what
 *     future recipients are told, never rewrite the history of what past
 *     recipients were told. Rendering from the template at READ time would
 *     silently rewrite a customer's evidence in a dispute.
 *
 *  2. `link_path` is validated here as well as by the 0021 check constraint
 *     (`like '/%' and not like '//%'`). The notification centre renders it
 *     straight into an href, so a protocol-relative or absolute URL reaching
 *     the column would be an open redirect. Two layers, per §17: the constraint
 *     makes the bad row unstorable, this check makes it unsendable and gives a
 *     legible error at the call site instead of a Postgres 23514.
 *
 *  3. This never throws. A notification is important but must not be able to
 *     unwind the business transaction that triggered it — a resolved grievance
 *     must stay resolved even if its notification insert fails. Same posture as
 *     `recordAuditEvent()` and `sendNotification()`. Callers therefore do not
 *     need (and should not add) a try/catch.
 *
 * Templates live in `notification_templates` with `channel = 'inapp'`; the
 * SMS-era rows there are retained history held inactive (§70) and are
 * deliberately not selectable through this path.
 */

/**
 * The in-app template keys that exist as of 0021. Typed as a union rather than
 * `string` so a typo becomes a compile error instead of a notification that
 * silently falls back to raw copy at runtime.
 *
 * `order_paid`, `order_ready`, `pickup_reminder`,
 * `order_cancelled_by_restaurant` and `refund_processed` were re-channelled
 * from 'sms' to 'inapp' by 0021; `order_collected`, `order_no_show` and
 * `grievance_resolved` were seeded there; `grievance_opened` and
 * `grievance_replied` were seeded by 0022 for Phase 8B.
 */
export type InAppTemplateKey =
  | "order_paid"
  | "order_ready"
  | "pickup_reminder"
  | "order_cancelled_by_restaurant"
  | "refund_processed"
  | "order_collected"
  | "order_no_show"
  | "grievance_opened"
  | "grievance_replied"
  | "grievance_resolved";

export type InAppNotificationInput = {
  userId: string;
  /** Template key in `notification_templates`. */
  template: InAppTemplateKey;
  /** `{{var}}` substitutions for the template's title and body. */
  variables?: Record<string, string | number | null | undefined>;
  /**
   * Relative path the notification opens. Must start with a single "/".
   * Omit for a notification with nothing to open.
   */
  linkPath?: string | null;
  orderId?: string | null;
  grievanceTicketId?: string | null;
  restaurantId?: string | null;
  /**
   * Copy to use when the template is missing or inactive. Without this a
   * missing template means no notification at all, which is the wrong
   * trade-off for events the customer is waiting on (a resolved ticket).
   */
  fallback?: { title: string; body: string };
};

/** Cheap render: `{{name}}` → value. Unmatched placeholders are removed. */
function render(text: string, variables: Record<string, string | number | null | undefined>): string {
  return text
    .replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, key: string) => {
      const value = variables[key];
      return value === null || value === undefined ? "" : String(value);
    })
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * A relative in-app path and nothing else. Rejects absolute URLs,
 * protocol-relative "//host" and anything with a scheme, mirroring
 * `notifications_link_path_check`.
 */
export function isSafeLinkPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("://") && !path.includes("\\");
}

/**
 * Inserts one in-app notification. Resolves and snapshots the copy, then
 * writes the row. Returns nothing and swallows its own failures by design
 * (see the header note).
 */
export async function sendInAppNotification(input: InAppNotificationInput): Promise<void> {
  try {
    const supabase = createServiceRoleSupabaseClient();
    const variables = input.variables ?? {};

    const { data: template } = await supabase
      .from("notification_templates")
      .select("key, title, body, is_active, channel")
      .eq("key", input.template)
      .maybeSingle();

    const usable = template && template.channel === "inapp" && template.is_active;

    const title = usable
      ? render(template!.title ?? input.fallback?.title ?? "UNI8", variables)
      : input.fallback?.title ?? null;
    const body = usable ? render(template!.body, variables) : input.fallback?.body ?? null;

    // Nothing to show is worse than nothing to send: a blank notification in
    // the bell is a dead end for the recipient.
    if (!title && !body) return;

    let linkPath: string | null = null;
    if (input.linkPath) {
      if (isSafeLinkPath(input.linkPath)) {
        linkPath = input.linkPath;
      } else {
        // Drop the link, keep the notification. The recipient still learns the
        // fact; they just have to navigate themselves.
        console.error(`[in-app] rejected unsafe link_path for ${input.template}: ${input.linkPath}`);
      }
    }

    await supabase.from("notifications").insert({
      user_id: input.userId,
      channel: "inapp",
      template: input.template,
      // `payload` predates the rendered columns and stays populated: it is the
      // machine-readable record of what the copy was rendered FROM, which is
      // what you want when copy and data disagree. `variables` values (string
      // | number | null | undefined) are already jsonb-safe; `undefined`
      // entries are dropped by JSON.stringify the same way Postgres would
      // treat them, so a real round-trip cast reflects what actually gets stored.
      payload: JSON.parse(JSON.stringify(variables)) as Json,
      status: "sent", // in-app delivery has no provider hop to be pending on
      title,
      body,
      link_path: linkPath,
      order_id: input.orderId ?? null,
      grievance_ticket_id: input.grievanceTicketId ?? null,
      restaurant_id: input.restaurantId ?? null,
    });
  } catch (error) {
    console.error("[in-app] notification insert failed", error);
  }
}

/**
 * Fan-out helper for the handful of callers that notify several recipients of
 * the same event (e.g. every super admin on an escalation). Sequential rather
 * than Promise.all: these lists are small, and a burst of parallel
 * service-role inserts is not worth the connection pressure.
 */
export async function sendInAppNotifications(inputs: InAppNotificationInput[]): Promise<void> {
  for (const input of inputs) {
    await sendInAppNotification(input);
  }
}
