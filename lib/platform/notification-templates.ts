import "server-only";

import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

/**
 * Notification templates (SRS §Y, V2.6 §63: "notification copy is Super
 * Admin-editable"). Every row here was seeded by `0016`/`0021`/`0022` — this
 * module is the first thing to actually READ or WRITE the table from
 * application code; until now it was configuration with no console.
 *
 * `channel = 'sms'` rows are retained, deactivated history from the pre-V2.6
 * design (see `0021`'s own migration comment) — listed here too, since an
 * operator auditing "what copy exists" should see the deprecated rows
 * clearly marked, not have them silently vanish.
 */

export type NotificationTemplateRow = {
  key: string;
  channel: string;
  title: string | null;
  body: string;
  description: string | null;
  variables: Json;
  dltTemplateId: string | null;
  isActive: boolean;
  updatedAt: string;
  updatedBy: string | null;
};

export async function listNotificationTemplates(): Promise<NotificationTemplateRow[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("notification_templates")
    .select("key, channel, title, body, description, variables, dlt_template_id, is_active, updated_at, updated_by")
    .order("channel", { ascending: false }) // inapp (active) before sms (retired history)
    .order("key");

  if (error || !data) return [];

  return data.map((row) => ({
    key: row.key,
    channel: row.channel,
    title: row.title,
    body: row.body,
    description: row.description,
    variables: row.variables,
    dltTemplateId: row.dlt_template_id,
    isActive: row.is_active,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }));
}

/** Auditing is the caller's job (lib/actions/admin/notification-templates.ts). */
export async function writeNotificationTemplate(
  key: string,
  input: { title: string | null; body: string; description: string | null; isActive: boolean },
  actorId: string
): Promise<{ previous: { title: string | null; body: string; description: string | null; isActive: boolean } | null }> {
  const supabase = createServiceRoleSupabaseClient();

  const { data: current } = await supabase
    .from("notification_templates")
    .select("title, body, description, is_active")
    .eq("key", key)
    .maybeSingle();

  const { error } = await supabase
    .from("notification_templates")
    .update({
      title: input.title,
      body: input.body,
      description: input.description,
      is_active: input.isActive,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    })
    .eq("key", key);

  if (error) throw new Error(`Could not update notification template "${key}": ${error.message}`);

  return {
    previous: current
      ? { title: current.title, body: current.body, description: current.description, isActive: current.is_active }
      : null,
  };
}
