"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { recordAuditEvent } from "@/lib/audit/log";
import { writeRetentionPolicy, RETENTION_DISPOSITIONS } from "@/lib/platform/data-retention";

/**
 * Retention register editing (SRS §P). A reason IS required here, unlike
 * notification copy — this is documented platform POLICY (how long
 * financial, grievance and audit data survives, and what happens to it
 * after), not wording, and §P's whole premise is that this decision must be
 * traceable.
 */

const UpdateRetentionPolicySchema = z.object({
  domain: z.string().trim().min(1),
  retentionPeriod: z.string().trim().min(1, "Describe the retention period, e.g. '3 years' or 'indefinite'."),
  disposition: z.enum(RETENTION_DISPOSITIONS),
  rationale: z.string().trim().max(1000).nullable(),
  automated: z.boolean(),
  reason: z.string().trim().min(1, "A reason is required for the audit log."),
});

export async function updateRetentionPolicy(input: z.input<typeof UpdateRetentionPolicySchema>) {
  const admin = await requireSuperAdmin();
  const parsed = UpdateRetentionPolicySchema.parse(input);

  try {
    const { previous } = await writeRetentionPolicy(
      parsed.domain,
      {
        retentionPeriod: parsed.retentionPeriod,
        disposition: parsed.disposition,
        rationale: parsed.rationale,
        automated: parsed.automated,
      },
      admin.id
    );

    await recordAuditEvent({
      actorId: admin.id,
      actorRole: admin.role,
      action: "data_retention_policy.updated",
      targetTable: "data_retention_policies",
      targetId: parsed.domain,
      before: previous,
      after: {
        retentionPeriod: parsed.retentionPeriod,
        disposition: parsed.disposition,
        rationale: parsed.rationale,
        automated: parsed.automated,
      },
      reason: parsed.reason,
    });
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not update the policy." };
  }

  revalidatePath("/admin/settings");
  return { ok: true as const };
}
