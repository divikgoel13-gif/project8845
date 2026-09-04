"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";

/**
 * SRS §S: "Super Admin can acknowledge, investigate and resolve flags." /
 * "Flags are data-driven, auditable and reviewable." One action handles all
 * three transitions (start investigating / resolve / dismiss) since they
 * share the same shape — a status change plus an optional note — and the
 * audit action name (`fraud_flag.investigating` / `.resolved` /
 * `.dismissed`) is what distinguishes them in the log, the same pattern
 * `setAnnouncementPublishedState` already uses for its own two-direction
 * toggle.
 *
 * This action ONLY ever writes to `fraud_flags`. §S is explicit that
 * detection "records flags without automatically banning a user" — the
 * symmetric rule applies to resolution too: resolving a flag here never
 * itself disables an account, cancels an order or blocks a scan. If the
 * investigation concludes the account should be disabled, that is a
 * SEPARATE, already-audited action (`setProfileStatus`,
 * `/admin/staff-access` or Customer 360) taken deliberately, not a side
 * effect of clicking "Resolve" here.
 */

const STATUS_TRANSITIONS = ["investigating", "resolved", "dismissed"] as const;

const UpdateFraudFlagSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(STATUS_TRANSITIONS),
  note: z.string().trim().max(1000).nullable(),
});

export async function updateFraudFlagStatus(input: z.input<typeof UpdateFraudFlagSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = UpdateFraudFlagSchema.parse(input);

  if ((parsed.status === "resolved" || parsed.status === "dismissed") && !parsed.note) {
    return { ok: false as const, error: "A note is required to resolve or dismiss a flag." };
  }

  const supabase = createServiceRoleSupabaseClient();

  const { data: current } = await supabase
    .from("fraud_flags")
    .select("status, resolution_note, subject_type, subject_id, signal")
    .eq("id", parsed.id)
    .maybeSingle();
  if (!current) return { ok: false as const, error: "This flag no longer exists." };

  const isTerminal = parsed.status === "resolved" || parsed.status === "dismissed";
  const { error } = await supabase
    .from("fraud_flags")
    .update({
      status: parsed.status,
      reviewed_by: admin.id,
      resolution_note: parsed.note,
      resolved_at: isTerminal ? new Date().toISOString() : null,
    })
    .eq("id", parsed.id);

  if (error) return { ok: false as const, error: error.message };

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: `fraud_flag.${parsed.status}`,
    targetTable: "fraud_flags",
    targetId: parsed.id,
    before: { status: current.status, resolutionNote: current.resolution_note },
    after: { status: parsed.status, resolutionNote: parsed.note },
    reason: parsed.note ?? undefined,
  });

  revalidatePath("/admin/audit/fraud");
  return { ok: true as const };
}
