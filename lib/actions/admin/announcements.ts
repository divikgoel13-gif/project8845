"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { recordAuditEvent } from "@/lib/audit/log";
import {
  createAnnouncement as createAnnouncementRow,
  updateAnnouncementContent,
  setAnnouncementPublished,
  archiveAnnouncementRow,
  type AnnouncementContentInput,
} from "@/lib/platform/announcements";

/**
 * SRS §O: "Create/edit/publish/unpublish/archive actions are audited." Five
 * verbs, five audit action names, matching the SRS's own wording exactly so
 * the audit log reads as a direct transcript of the requirement.
 */

const ContentSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required.").max(200),
    message: z.string().trim().min(1, "Message is required.").max(1000),
    severity: z.enum(["info", "warning", "critical"]),
    scope: z.enum(["global", "restaurant"]),
    restaurantId: z.string().uuid().nullable(),
    startsAt: z.string().datetime().nullable(),
    endsAt: z.string().datetime().nullable(),
  })
  // The DB has no check constraint tying scope to restaurant_id (see
  // 0004_support_and_platform_tables.sql) — enforced here instead, the same
  // way as everywhere else in this codebase that pairs an enum with an
  // optional foreign key (e.g. restaurants.location_type / university_place_name).
  .refine((v) => (v.scope === "restaurant" ? v.restaurantId !== null : v.restaurantId === null), {
    message: "Restaurant-scoped announcements need a restaurant; global announcements must not have one.",
    path: ["restaurantId"],
  })
  .refine((v) => !(v.startsAt && v.endsAt) || new Date(v.startsAt) < new Date(v.endsAt), {
    message: "End time must be after start time.",
    path: ["endsAt"],
  });

function contentInput(parsed: z.infer<typeof ContentSchema>): AnnouncementContentInput {
  return {
    title: parsed.title,
    message: parsed.message,
    severity: parsed.severity,
    scope: parsed.scope,
    restaurantId: parsed.restaurantId,
    startsAt: parsed.startsAt,
    endsAt: parsed.endsAt,
  };
}

export async function createAnnouncement(input: z.input<typeof ContentSchema>) {
  const admin = await requireSuperAdmin();
  const result = ContentSchema.safeParse(input);
  if (!result.success) return { ok: false as const, error: result.error.issues[0]?.message ?? "Invalid input." };
  const parsed = result.data;

  let id: string;
  try {
    ({ id } = await createAnnouncementRow(contentInput(parsed), admin.id));
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not create the announcement." };
  }

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: "announcement.created",
    targetTable: "announcements",
    targetId: id,
    restaurantId: parsed.restaurantId ?? undefined,
    after: contentInput(parsed),
  });

  revalidatePath("/admin/operations");
  return { ok: true as const, id };
}

const UpdateSchema = ContentSchema.and(z.object({ id: z.string().uuid() }));

export async function updateAnnouncement(input: z.input<typeof UpdateSchema>) {
  const admin = await requireSuperAdmin();
  const result = UpdateSchema.safeParse(input);
  if (!result.success) return { ok: false as const, error: result.error.issues[0]?.message ?? "Invalid input." };
  const parsed = result.data;

  let previous: AnnouncementContentInput | null;
  try {
    ({ previous } = await updateAnnouncementContent(parsed.id, contentInput(parsed), admin.id));
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not update the announcement." };
  }

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: "announcement.updated",
    targetTable: "announcements",
    targetId: parsed.id,
    restaurantId: parsed.restaurantId ?? undefined,
    before: previous,
    after: contentInput(parsed),
  });

  revalidatePath("/admin/operations");
  return { ok: true as const };
}

const SetPublishedSchema = z.object({ id: z.string().uuid(), isPublished: z.boolean() });

export async function setAnnouncementPublishedState(input: z.input<typeof SetPublishedSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = SetPublishedSchema.parse(input);

  try {
    const { previous } = await setAnnouncementPublished(parsed.id, parsed.isPublished, admin.id);

    await recordAuditEvent({
      actorId: admin.id,
      actorRole: admin.role,
      action: parsed.isPublished ? "announcement.published" : "announcement.unpublished",
      targetTable: "announcements",
      targetId: parsed.id,
      before: previous,
      after: parsed.isPublished,
    });
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not update the announcement." };
  }

  revalidatePath("/admin/operations");
  return { ok: true as const };
}

const ArchiveSchema = z.object({ id: z.string().uuid() });

export async function archiveAnnouncement(input: z.input<typeof ArchiveSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = ArchiveSchema.parse(input);

  try {
    const { wasAlreadyArchived } = await archiveAnnouncementRow(parsed.id, admin.id);
    if (wasAlreadyArchived) return { ok: false as const, error: "This announcement is already archived." };

    await recordAuditEvent({
      actorId: admin.id,
      actorRole: admin.role,
      action: "announcement.archived",
      targetTable: "announcements",
      targetId: parsed.id,
    });
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not archive the announcement." };
  }

  revalidatePath("/admin/operations");
  return { ok: true as const };
}
