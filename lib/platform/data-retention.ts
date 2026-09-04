import "server-only";

import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";

/**
 * Data retention register (SRS §P: "Retention periods and deletion/
 * anonymization behaviour must be documented before production launch").
 *
 * `0016`'s migration comment already explains the design choice this module
 * inherits: the register is kept IN the database, editable by Super Admin,
 * "rather than only in markdown, so the operational policy and the
 * documented policy cannot drift." This module is that editability — until
 * now the register was seeded once and had no console.
 *
 * `domain` is the primary key and is not editable (it identifies WHICH
 * table/bucket a row documents); `disposition` is constrained to the four
 * values `0016` defined at the database level, so the write path validates
 * against that same list rather than trusting free text.
 */

export const RETENTION_DISPOSITIONS = ["retain_indefinitely", "archive", "anonymize", "delete"] as const;
export type RetentionDisposition = (typeof RETENTION_DISPOSITIONS)[number];

export type RetentionPolicyRow = {
  domain: string;
  retentionPeriod: string;
  disposition: RetentionDisposition;
  rationale: string | null;
  automated: boolean;
  updatedAt: string;
  updatedBy: string | null;
};

export async function listRetentionPolicies(): Promise<RetentionPolicyRow[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("data_retention_policies")
    .select("domain, retention_period, disposition, rationale, automated, updated_at, updated_by")
    .order("domain");

  if (error || !data) return [];

  return data.map((row) => ({
    domain: row.domain,
    retentionPeriod: row.retention_period,
    disposition: row.disposition as RetentionDisposition,
    rationale: row.rationale,
    automated: row.automated,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }));
}

/** Auditing is the caller's job (lib/actions/admin/data-retention.ts). */
export async function writeRetentionPolicy(
  domain: string,
  input: { retentionPeriod: string; disposition: RetentionDisposition; rationale: string | null; automated: boolean },
  actorId: string
): Promise<{
  previous: { retentionPeriod: string; disposition: RetentionDisposition; rationale: string | null; automated: boolean } | null;
}> {
  const supabase = createServiceRoleSupabaseClient();

  const { data: current } = await supabase
    .from("data_retention_policies")
    .select("retention_period, disposition, rationale, automated")
    .eq("domain", domain)
    .maybeSingle();

  const { error } = await supabase
    .from("data_retention_policies")
    .update({
      retention_period: input.retentionPeriod,
      disposition: input.disposition,
      rationale: input.rationale,
      automated: input.automated,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    })
    .eq("domain", domain);

  if (error) throw new Error(`Could not update the retention policy for "${domain}": ${error.message}`);

  return {
    previous: current
      ? {
          retentionPeriod: current.retention_period,
          disposition: current.disposition as RetentionDisposition,
          rationale: current.rationale,
          automated: current.automated,
        }
      : null,
  };
}
