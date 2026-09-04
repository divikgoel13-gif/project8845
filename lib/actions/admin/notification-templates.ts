"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { recordAuditEvent } from "@/lib/audit/log";
import { writeNotificationTemplate } from "@/lib/platform/notification-templates";

/**
 * Notification copy editing (SRS §Y, V2.6 §63). `key` and `channel` are not
 * editable here — the key is the code's own lookup handle
 * (`lib/notifications/*` reads templates by key, per `0016`'s migration
 * comment) and changing it would silently break every send call site;
 * channel is a historical marker (`inapp` is live, `sms` is retained
 * deactivated history — see `lib/platform/notification-templates.ts`) rather
 * than an operator choice, since V2.6 §63 already decided V1 is in-app only.
 *
 * No reason field, unlike the settings/flags/maintenance actions above: this
 * edits WORDING, not platform behaviour or trust — closer in weight to
 * editing a grievance response template (`grievance_templates`, Phase 8),
 * which likewise required no reason. The before/after body is already fully
 * recorded in the audit entry, which is the durable record §Y needs.
 */

const UpdateNotificationTemplateSchema = z.object({
  key: z.string().trim().min(1),
  title: z.string().trim().max(200).nullable(),
  body: z.string().trim().min(1, "Body cannot be empty.").max(1000),
  description: z.string().trim().max(500).nullable(),
  isActive: z.boolean(),
});

export async function updateNotificationTemplate(input: z.input<typeof UpdateNotificationTemplateSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = UpdateNotificationTemplateSchema.parse(input);

  try {
    const { previous } = await writeNotificationTemplate(
      parsed.key,
      { title: parsed.title, body: parsed.body, description: parsed.description, isActive: parsed.isActive },
      admin.id
    );

    await recordAuditEvent({
      actorId: admin.id,
      actorRole: admin.role,
      action: "notification_template.updated",
      targetTable: "notification_templates",
      targetId: parsed.key,
      before: previous,
      after: { title: parsed.title, body: parsed.body, description: parsed.description, isActive: parsed.isActive },
    });
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not update the template." };
  }

  revalidatePath("/admin/settings");
  return { ok: true as const };
}
