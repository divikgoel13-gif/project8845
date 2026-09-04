"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";

/**
 * Restaurant access grants (SRS §8 access control, §11 "maximum five active
 * staff per restaurant").
 *
 * Three rules the shape of this file follows from:
 *
 *  - A grant is never deleted (§P, §8). Revoking sets `disabled_at`, so "who had
 *    access in March" stays answerable and a re-grant is a distinct, dated event.
 *  - The five-staff cap is enforced by the `enforce_staff_limit` trigger in
 *    0006. This file still checks it first, only so the operator gets a sentence
 *    instead of a database error — the trigger remains the authority.
 *  - Granting access does not change a profile's role. The candidate must already
 *    be a `vendor_admin` or `staff`; see `listGrantCandidates`.
 */

const GrantSchema = z.object({
  restaurantId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(["vendor_admin", "staff"]),
});

const STAFF_CAP = 5;

function tableFor(role: "vendor_admin" | "staff") {
  return role === "vendor_admin" ? "vendor_admin_memberships" : "restaurant_staff";
}

export async function grantRestaurantAccess(input: z.input<typeof GrantSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = GrantSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();
  const table = tableFor(parsed.role);

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, status, name, email")
    .eq("id", parsed.userId)
    .maybeSingle();

  if (!profile) return { ok: false as const, error: "That user does not exist." };
  if (profile.role !== parsed.role) {
    return {
      ok: false as const,
      error: `That account is a ${profile.role}. Change the account's role before granting ${parsed.role} access.`,
    };
  }
  if (profile.status !== "active") {
    return { ok: false as const, error: "That account is disabled. Re-enable it before granting access." };
  }

  if (parsed.role === "staff") {
    const { count } = await supabase
      .from("restaurant_staff")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", parsed.restaurantId)
      .is("disabled_at", null);
    if ((count ?? 0) >= STAFF_CAP) {
      return {
        ok: false as const,
        error: `This restaurant already has ${STAFF_CAP} active staff. Revoke one before adding another.`,
      };
    }
  }

  // `(user_id, restaurant_id)` is unique, so a re-grant is an update of the
  // existing row's `disabled_at` rather than a second row. That keeps the
  // grant's original `created_at` — the date access was first given — intact.
  const { data: existing } = await supabase
    .from(table)
    .select("id, disabled_at")
    .eq("restaurant_id", parsed.restaurantId)
    .eq("user_id", parsed.userId)
    .maybeSingle();

  if (existing) {
    if (!existing.disabled_at) return { ok: false as const, error: "That user already has access." };
    const { error } = await supabase.from(table).update({ disabled_at: null }).eq("id", existing.id);
    if (error) return { ok: false as const, error: error.message };
  } else {
    const { error } = await supabase
      .from(table)
      .insert({ restaurant_id: parsed.restaurantId, user_id: parsed.userId });
    if (error) return { ok: false as const, error: error.message };
  }

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: `${parsed.role}.access_granted`,
    targetTable: table,
    targetId: parsed.userId,
    restaurantId: parsed.restaurantId,
    after: { userId: parsed.userId, email: profile.email, name: profile.name, reinstated: Boolean(existing) },
  });

  revalidatePath(`/admin/restaurants/${parsed.restaurantId}/${parsed.role === "staff" ? "staff" : "vendor-admins"}`);
  revalidatePath("/admin/staff-access");
  return { ok: true as const };
}

const RevokeSchema = z.object({
  restaurantId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(["vendor_admin", "staff"]),
  reason: z.string().trim().min(1, "A reason is required.").max(500),
});

/**
 * Revocation is dated, not deleted, and carries a reason — §8 treats losing
 * access as a security event, and "why was this person removed" is the question
 * asked months later.
 *
 * Existing orders are untouched. Staff losing access cannot mark orders ready any
 * more, but the orders they already handled keep their history (§P).
 */
export async function revokeRestaurantAccess(input: z.input<typeof RevokeSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = RevokeSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();
  const table = tableFor(parsed.role);

  const { data: before } = await supabase
    .from(table)
    .select("id, user_id, created_at, disabled_at")
    .eq("restaurant_id", parsed.restaurantId)
    .eq("user_id", parsed.userId)
    .maybeSingle();

  if (!before) return { ok: false as const, error: "That user does not have access to this restaurant." };
  if (before.disabled_at) return { ok: false as const, error: "That access was already revoked." };

  const now = new Date().toISOString();
  const { error } = await supabase.from(table).update({ disabled_at: now }).eq("id", before.id);
  if (error) return { ok: false as const, error: error.message };

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: `${parsed.role}.access_revoked`,
    targetTable: table,
    targetId: parsed.userId,
    restaurantId: parsed.restaurantId,
    before,
    after: { disabled_at: now },
    reason: parsed.reason,
  });

  revalidatePath(`/admin/restaurants/${parsed.restaurantId}/${parsed.role === "staff" ? "staff" : "vendor-admins"}`);
  revalidatePath("/admin/staff-access");
  return { ok: true as const };
}

const ProfileStatusSchema = z.object({
  userId: z.string().uuid(),
  status: z.enum(["active", "disabled"]),
  reason: z.string().trim().min(1, "A reason is required.").max(500),
  /** Only used to revalidate the page the operator is looking at. */
  restaurantId: z.string().uuid().optional(),
});

/**
 * Platform-wide suspension (SRS §8). `profiles.status` is the ONLY suspension
 * mechanism in the schema — there is no per-restaurant "suspended" flag — so this
 * is a heavier action than revoking one grant, and the audit entry says so by
 * targeting `profiles` rather than a membership table.
 *
 * The account is never deleted: §8 and §P require authentication history to
 * survive, and a deleted profile would orphan every order and audit row that
 * references it.
 */
export async function setProfileStatus(input: z.input<typeof ProfileStatusSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = ProfileStatusSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  if (parsed.userId === admin.id) {
    // Locking the only super admin out of the console is unrecoverable from
    // inside the product.
    return { ok: false as const, error: "You cannot disable your own account." };
  }

  const { data: before } = await supabase
    .from("profiles")
    .select("id, role, status, name, email")
    .eq("id", parsed.userId)
    .maybeSingle();

  if (!before) return { ok: false as const, error: "That user does not exist." };
  if (before.status === parsed.status) {
    return { ok: false as const, error: `That account is already ${parsed.status}.` };
  }

  const { error } = await supabase.from("profiles").update({ status: parsed.status }).eq("id", parsed.userId);
  if (error) return { ok: false as const, error: error.message };

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: parsed.status === "disabled" ? "profile.disabled" : "profile.reenabled",
    targetTable: "profiles",
    targetId: parsed.userId,
    restaurantId: parsed.restaurantId,
    before,
    after: { status: parsed.status },
    reason: parsed.reason,
  });

  if (parsed.restaurantId) {
    revalidatePath(`/admin/restaurants/${parsed.restaurantId}/staff`);
    revalidatePath(`/admin/restaurants/${parsed.restaurantId}/vendor-admins`);
  }
  revalidatePath("/admin/staff-access");
  return { ok: true as const };
}

const ForceLogoutSchema = z.object({
  userId: z.string().uuid(),
  /** Only used to revalidate the page the operator is looking at. */
  restaurantId: z.string().uuid().optional(),
});

/**
 * Standalone credential control (SRS §8: "...force logout actions" is named
 * alongside, not folded into, deactivation). Until this pass the only place
 * `force_logout_user()` (0014) was ever called was bundled inside the
 * vendor-side staff deactivate/reset flows (`lib/actions/vendor/staff.ts`) —
 * there was no way for a Super Admin to end a session WITHOUT also disabling
 * the account. That gap matters for exactly the incident this exists for: a
 * report of a compromised or shared password where the operator wants the
 * current session killed right now and to investigate before deciding
 * whether to disable anything.
 *
 * Deliberately no self-protection check (contrast `setProfileStatus`, which
 * blocks disabling your own account): forcing your OWN session out is fully
 * recoverable by logging back in, unlike disabling your own account, which
 * would need direct database access to undo.
 *
 * Best-effort, matching the existing call sites: `force_logout_user` failing
 * does not roll back anything because there is nothing to roll back — this
 * action performs no other write.
 */
export async function forceLogoutUser(input: z.input<typeof ForceLogoutSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = ForceLogoutSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: target } = await supabase
    .from("profiles")
    .select("id, name, email, role")
    .eq("id", parsed.userId)
    .maybeSingle();
  if (!target) return { ok: false as const, error: "That user does not exist." };

  const { error } = await supabase.rpc("force_logout_user", { target_user_id: parsed.userId });
  if (error) return { ok: false as const, error: error.message };

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: "profile.force_logout",
    targetTable: "profiles",
    targetId: parsed.userId,
    restaurantId: parsed.restaurantId,
    after: { name: target.name, email: target.email, role: target.role },
  });

  if (parsed.restaurantId) {
    revalidatePath(`/admin/restaurants/${parsed.restaurantId}/staff`);
    revalidatePath(`/admin/restaurants/${parsed.restaurantId}/vendor-admins`);
  }
  revalidatePath("/admin/staff-access");
  return { ok: true as const };
}
