"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";
import { setProfileStatus } from "@/lib/actions/admin/restaurant-access";

/**
 * The write side of the Customer 360 CRM (SRS §7.2 "Admin Notes", §7.3 manual
 * flags, §8 account suspension).
 *
 * Four rules the shape of this file follows from:
 *
 *  - Nothing here deletes. A note is append-only and a flag is cleared by
 *    dating it, never by removing the row (§7.3 "must be auditable", §P). The
 *    question asked six months later is "who flagged this person, why, and who
 *    decided it no longer applied" — a delete answers none of it.
 *  - Every mutation carries a reason typed by a human, and the reason is stored
 *    on the row as well as in `audit_logs`. The row is what the next operator
 *    reads on the page; the audit entry is what survives independently of it.
 *  - This module never invents a manual flag from data. The six §7.3 badges are
 *    DERIVED on read by `deriveCustomerFlags` and have no rows at all; a manual
 *    flag exists only because a person wrote one, which is the distinction that
 *    keeps "flagged" meaningful.
 *  - Account suspension is NOT reimplemented here. `setProfileStatus` in
 *    `restaurant-access.ts` already owns `profiles.status`, including the refusal
 *    to disable your own account, and a second copy would be a second set of
 *    rules for the same column.
 *
 * Every action re-checks the caller with `requireSuperAdmin()` rather than
 * trusting the middleware gate, and only then reaches for the service-role
 * client. Notes and flags are super-admin-only in RLS (0017) with no self-select
 * policy, so a customer cannot read what is written here.
 */

/** Long enough to hold an actual account, short enough to stay readable. */
const NOTE_MAX = 4_000;
const REASON_MAX = 500;

/**
 * A guard, not a formality: `customer_admin_notes.customer_id` and
 * `customer_flags.customer_id` both reference `profiles`, so the FK would happily
 * accept a vendor admin or another super admin. Notes about staff belong in the
 * staff access trail, and a flag on a vendor account would render on no page
 * that anybody reads.
 */
async function requireCustomer(
  supabase: ReturnType<typeof createServiceRoleSupabaseClient>,
  customerId: string
): Promise<{ ok: true; name: string | null } | { ok: false; error: string }> {
  const { data } = await supabase
    .from("profiles")
    .select("id, role, name")
    .eq("id", customerId)
    .maybeSingle();

  if (!data) return { ok: false, error: "That customer does not exist." };
  const row = data as { role: string; name: string | null };
  if (row.role !== "customer") {
    return { ok: false, error: `That account is a ${row.role}, not a customer.` };
  }
  return { ok: true, name: row.name };
}

/** Both CRM pages that can be looking at this customer when something changes. */
function revalidateCustomer(customerId: string) {
  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/customers");
}

/* ── Admin notes (SRS §7.2) ─────────────────────────────────────────────── */

const NoteSchema = z.object({
  customerId: z.string().uuid(),
  body: z
    .string()
    .trim()
    .min(3, "Write the note before saving it.")
    .max(NOTE_MAX, `Keep the note under ${NOTE_MAX} characters.`),
});

/**
 * Append an internal note.
 *
 * `author_id` comes from the session and is never a form field — a note whose
 * author could be chosen by the submitter is not attribution. There is
 * deliberately no edit and no delete action: §7.2 asks for notes "with
 * author/timestamp and audit trail", and history you can rewrite is not one.
 *
 * The audit entry records the note's id and length but NOT its text. The body is
 * already stored, once, on a row that only super admins can read; copying it into
 * `audit_logs` would duplicate internal commentary about a named person into a
 * second table with a different retention story.
 */
export async function addCustomerNote(input: z.input<typeof NoteSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = NoteSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const customer = await requireCustomer(supabase, parsed.customerId);
  if (!customer.ok) return { ok: false as const, error: customer.error };

  const { data, error } = await supabase
    .from("customer_admin_notes")
    .insert({ customer_id: parsed.customerId, author_id: admin.id, body: parsed.body })
    .select("id")
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message };

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: "customer.note_added",
    targetTable: "customer_admin_notes",
    targetId: (data as { id: string } | null)?.id ?? parsed.customerId,
    after: { customerId: parsed.customerId, noteLength: parsed.body.length },
  });

  revalidateCustomer(parsed.customerId);
  return { ok: true as const };
}

/* ── Manual flags (SRS §7.3) ─────────────────────────────────────────────── */

const AddFlagSchema = z.object({
  customerId: z.string().uuid(),
  /**
   * Free text, because §7.3's own six categories are the DERIVED ones and a
   * manual flag exists for the case the data cannot see — a documented dispute,
   * an agreement made over the counter, a request from the university. An enum
   * here would mean the only flags an operator can raise are the ones already
   * computed for them.
   */
  flag: z
    .string()
    .trim()
    .min(3, "Give the flag a short label.")
    .max(60, "Keep the label short — the reason field is for the detail."),
  reason: z
    .string()
    .trim()
    .min(5, "A reason is required, and it has to say something.")
    .max(REASON_MAX),
});

/**
 * Raise a manual flag.
 *
 * The reason is mandatory at the schema level and stored on the row, not only in
 * the audit log, because §7.3 requires flags to be "data-driven, not arbitrary
 * character judgments": a label with no stated basis is exactly the arbitrary
 * judgment the SRS is warning about, and the page renders the basis next to the
 * label so it cannot be read without it.
 *
 * Raising the same active label twice is refused. Two identical badges tell an
 * operator nothing the first one did not, and clearing one would leave the other
 * standing.
 */
export async function addCustomerFlag(input: z.input<typeof AddFlagSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = AddFlagSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const customer = await requireCustomer(supabase, parsed.customerId);
  if (!customer.ok) return { ok: false as const, error: customer.error };

  const { data: active } = await supabase
    .from("customer_flags")
    .select("id, flag")
    .eq("customer_id", parsed.customerId)
    .is("cleared_at", null)
    .limit(100);

  const clash = ((active ?? []) as { id: string; flag: string }[]).find(
    (f) => f.flag.trim().toLowerCase() === parsed.flag.toLowerCase()
  );
  if (clash) return { ok: false as const, error: `“${parsed.flag}” is already an active flag on this customer.` };

  const { data, error } = await supabase
    .from("customer_flags")
    .insert({
      customer_id: parsed.customerId,
      flag: parsed.flag,
      reason: parsed.reason,
      created_by: admin.id,
    })
    .select("id")
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message };

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: "customer.flag_added",
    targetTable: "customer_flags",
    targetId: (data as { id: string } | null)?.id ?? parsed.customerId,
    after: { customerId: parsed.customerId, flag: parsed.flag },
    reason: parsed.reason,
  });

  revalidateCustomer(parsed.customerId);
  return { ok: true as const };
}

const ClearFlagSchema = z.object({
  flagId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(5, "Say why the flag no longer applies.")
    .max(REASON_MAX),
});

/**
 * Retire a flag by dating it. The row stays, with `cleared_at`, `cleared_by` and
 * `clear_reason` filled in, and the 360 page lists cleared flags in their own
 * section — "this was flagged in March and lifted in April, by these two people,
 * for these two reasons" is the useful record, and a delete would leave only the
 * bare fact that nothing is flagged now.
 *
 * `customerId` is read off the row rather than accepted from the caller, so a
 * mismatched pair cannot revalidate one customer's page while clearing another's
 * flag.
 */
export async function clearCustomerFlag(input: z.input<typeof ClearFlagSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = ClearFlagSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: before } = await supabase
    .from("customer_flags")
    .select("id, customer_id, flag, reason, created_by, created_at, cleared_at")
    .eq("id", parsed.flagId)
    .maybeSingle();

  if (!before) return { ok: false as const, error: "That flag does not exist." };
  const row = before as { customer_id: string; flag: string; cleared_at: string | null };
  if (row.cleared_at) return { ok: false as const, error: "That flag was already cleared." };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("customer_flags")
    .update({ cleared_at: now, cleared_by: admin.id, clear_reason: parsed.reason })
    .eq("id", parsed.flagId);

  if (error) return { ok: false as const, error: error.message };

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: "customer.flag_cleared",
    targetTable: "customer_flags",
    targetId: parsed.flagId,
    before,
    after: { cleared_at: now, cleared_by: admin.id },
    reason: parsed.reason,
  });

  revalidateCustomer(row.customer_id);
  return { ok: true as const };
}

/* ── Account suspension (SRS §7.2 "Account & Security", §8) ─────────────── */

const AccountStatusSchema = z.object({
  customerId: z.string().uuid(),
  status: z.enum(["active", "disabled"]),
  reason: z.string().trim().min(5, "A reason is required.").max(REASON_MAX),
});

/**
 * Disable or re-enable a customer's platform account.
 *
 * This is a thin wrapper over `setProfileStatus`, deliberately: that function
 * already owns `profiles.status` — the only suspension mechanism in the schema —
 * along with the refusal to disable your own account, the "already disabled"
 * check, and the `profile.disabled` / `profile.reenabled` audit entries. Writing
 * the update again here would give one column two sets of rules, and the pair
 * would drift the first time either changed.
 *
 * All this adds is the customer-side revalidation, since `setProfileStatus`
 * revalidates the staff and restaurant pages it was written for. The guard runs
 * inside it; running it here too is redundant, so it does not.
 *
 * Disabling stops the account signing in. It does not touch orders already
 * placed, refunds owed, or open grievances — §P keeps that history, and a
 * customer who is owed money must still be findable after being locked out.
 */
export async function setCustomerAccountStatus(input: z.input<typeof AccountStatusSchema>) {
  const parsed = AccountStatusSchema.parse(input);

  const result = await setProfileStatus({
    userId: parsed.customerId,
    status: parsed.status,
    reason: parsed.reason,
  });

  if (result.ok) revalidateCustomer(parsed.customerId);
  return result;
}
