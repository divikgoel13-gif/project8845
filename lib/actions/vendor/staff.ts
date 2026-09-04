"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRestaurantScope } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";

/**
 * Vendor Admin staff management (SRS Phase 4, §10 "Manage Staff" row:
 * "Create/deactivate/reactivate up to 5 active staff; view credentials
 * through secure reset flow; view activity").
 *
 * A note on scope, since the SRS is genuinely ambiguous here and this is
 * worth being explicit about rather than silently picking a side: §6
 * (Restaurant Workspace) lists staff creation under the SUPER ADMIN
 * capabilities table, but §10 — the section this Phase 4 deliverable list
 * is drawn from — explicitly lists "Manage Staff" as a page on the VENDOR
 * ADMIN's own dashboard. This file implements §10's reading: a Vendor
 * Admin manages staff for their OWN restaurant directly, which is not a
 * contradiction of §6 so much as a normal dual-control pattern (the
 * restaurant owner has full CRUD on their own staff; the platform admin
 * separately retains override authority over every restaurant via the
 * Restaurant Workspace, which is Phase 7/8 scope, not built here). See
 * docs/AUTH_RBAC.md's "no self-service signup" note, which is refined by
 * this file rather than contradicted: staff still never self-signup, and
 * still go through a privileged Server Action using the service-role
 * client — that Server Action is just scoped to the Vendor Admin who
 * manages them, not exclusively to Super Admin.
 *
 * Staff accounts authenticate with email + password (SRS §3). Only a
 * VENDOR ADMIN (never staff — SRS §11: staff have "no ... settings
 * access") may call these actions, and always for their own restaurant.
 */

const AT_LEAST_ONE_UPPER = /[A-Z]/;
const AT_LEAST_ONE_DIGIT = /[0-9]/;

/**
 * A one-time, system-generated temporary password. Never stored anywhere
 * (not in the DB, not logged) — returned once to the calling Vendor
 * Admin so they can hand it to the staff member directly, matching §10's
 * "view credentials through secure reset flow" without the platform ever
 * persisting a plaintext credential (SRS §1.1: "Super Admin can
 * reset/disable staff/vendor accounts without seeing plaintext
 * passwords" — the same guarantee applies here: this function generates
 * and returns it, and nothing downstream retains it).
 */
function generateTemporaryPassword(): string {
  let candidate = randomBytes(12).toString("base64url");
  if (!AT_LEAST_ONE_UPPER.test(candidate)) candidate = "A" + candidate;
  if (!AT_LEAST_ONE_DIGIT.test(candidate)) candidate = candidate + "7";
  return candidate;
}

const CreateStaffSchema = z.object({
  restaurantId: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required.").max(150),
  email: z.string().trim().email("Enter a valid email address."),
});

export async function createStaffMember(input: { restaurantId: string; name: string; email: string }) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = CreateStaffSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  // Friendly pre-check ahead of the hard DB-level backstop (trigger
  // enforce_staff_limit in 0007_functions_and_triggers.sql) — SRS §11:
  // "Maximum 5 active staff per restaurant." The trigger is the real
  // guarantee; this just avoids creating a live Auth user only to have
  // the membership insert fail after the fact.
  const { count: activeCount } = await supabase
    .from("restaurant_staff")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", parsed.restaurantId)
    .is("disabled_at", null);

  if ((activeCount ?? 0) >= 5) {
    throw new Error("This restaurant already has 5 active staff — deactivate one before adding another.");
  }

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("email", parsed.email)
    .maybeSingle();

  if (existingProfile) {
    throw new Error(
      existingProfile.role === "staff"
        ? "This email is already a staff account. Reactivate it for this restaurant instead of creating a new one, if that's the intent."
        : "This email is already registered under a different role."
    );
  }

  const temporaryPassword = generateTemporaryPassword();

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: parsed.email,
    password: temporaryPassword,
    email_confirm: true,
  });

  if (createError || !created.user) {
    throw new Error(createError?.message ?? "Could not create the staff login.");
  }

  const userId = created.user.id;

  // The on-auth-user-created trigger already inserted a `profiles` row
  // with role='customer' (its safe default — SRS §8: elevated roles are
  // "never self-assigned at signup"). Promote it to 'staff' here, via the
  // service-role client, which is the one path allowed to do so
  // (trg_prevent_self_role_escalation blocks this for any non-service,
  // non-super_admin caller).
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ role: "staff", name: parsed.name })
    .eq("id", userId);

  if (profileError) {
    await supabase.auth.admin.deleteUser(userId); // roll back the orphaned Auth user
    throw new Error(profileError.message);
  }

  const { error: membershipError } = await supabase
    .from("restaurant_staff")
    .insert({ user_id: userId, restaurant_id: parsed.restaurantId });

  if (membershipError) {
    await supabase.auth.admin.deleteUser(userId); // roll back — see above
    throw new Error(
      membershipError.message.includes("already has 5 active staff")
        ? "This restaurant already has 5 active staff — deactivate one before adding another."
        : membershipError.message
    );
  }

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "staff.created",
    targetTable: "restaurant_staff",
    targetId: userId,
    restaurantId: parsed.restaurantId,
    after: { name: parsed.name, email: parsed.email },
  });

  revalidatePath("/vendor/staff");

  // Returned exactly once — the caller (UI) must show this to the Vendor
  // Admin in a "copy this now, it won't be shown again" affordance.
  return { userId, email: parsed.email, temporaryPassword };
}

const StaffMembershipActionSchema = z.object({
  restaurantId: z.string().uuid(),
  staffUserId: z.string().uuid(),
});

export async function deactivateStaffMember(input: { restaurantId: string; staffUserId: string }) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = StaffMembershipActionSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: membership } = await supabase
    .from("restaurant_staff")
    .select("id, disabled_at")
    .eq("restaurant_id", parsed.restaurantId)
    .eq("user_id", parsed.staffUserId)
    .single();

  if (!membership) throw new Error("Staff member not found for this restaurant.");
  if (membership.disabled_at) return; // already deactivated — idempotent

  const { error } = await supabase
    .from("restaurant_staff")
    .update({ disabled_at: new Date().toISOString() })
    .eq("id", membership.id);

  if (error) throw new Error(error.message);

  // Force logout: a deactivated staff member's existing session must not
  // keep working (SRS §8: "...force logout actions"). Note:
  // supabase.auth.admin.signOut() takes a session JWT, not a user id —
  // there is no per-user-id "kill all sessions" call in the Admin API —
  // so this goes through the force_logout_user() SECURITY DEFINER
  // function from 0014_force_logout_function.sql instead, which does the
  // same thing Supabase's own signOut() does internally (deletes the
  // user's auth.refresh_tokens rows). Best-effort — a failure here
  // doesn't roll back the deactivation itself, since being deactivated-
  // but-not-yet-logged-out is a much smaller exposure than failing to
  // deactivate at all.
  const { error: forceLogoutError } = await supabase.rpc("force_logout_user", { target_user_id: parsed.staffUserId });
  if (forceLogoutError) {
    console.error("[staff] deactivated but force-logout failed", parsed.staffUserId, forceLogoutError);
  }

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "staff.deactivated",
    targetTable: "restaurant_staff",
    targetId: parsed.staffUserId,
    restaurantId: parsed.restaurantId,
    before: { disabled_at: null },
    after: { disabled_at: new Date().toISOString() },
  });

  revalidatePath("/vendor/staff");
}

export async function reactivateStaffMember(input: { restaurantId: string; staffUserId: string }) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = StaffMembershipActionSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: membership } = await supabase
    .from("restaurant_staff")
    .select("id, disabled_at")
    .eq("restaurant_id", parsed.restaurantId)
    .eq("user_id", parsed.staffUserId)
    .single();

  if (!membership) throw new Error("Staff member not found for this restaurant.");
  if (!membership.disabled_at) return; // already active — idempotent

  // No pre-check here — the enforce_staff_limit trigger is the correct
  // place for this to fail loudly ("restaurant already has 5 active
  // staff") since reactivation is exactly the case that trigger exists
  // to catch.
  const { error } = await supabase.from("restaurant_staff").update({ disabled_at: null }).eq("id", membership.id);

  if (error) {
    throw new Error(
      error.message.includes("already has 5 active staff")
        ? "This restaurant already has 5 active staff — deactivate one before reactivating another."
        : error.message
    );
  }

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "staff.reactivated",
    targetTable: "restaurant_staff",
    targetId: parsed.staffUserId,
    restaurantId: parsed.restaurantId,
    before: { disabled_at: membership.disabled_at },
    after: { disabled_at: null },
  });

  revalidatePath("/vendor/staff");
}

/**
 * "View credentials through secure reset flow" (SRS §10) — generates a
 * fresh temporary password, sets it via the Admin API, force-logs-out
 * every existing session for that account, and returns the new password
 * exactly once. Nothing is persisted in plaintext at any point.
 */
export async function resetStaffCredential(input: { restaurantId: string; staffUserId: string }) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = StaffMembershipActionSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: membership } = await supabase
    .from("restaurant_staff")
    .select("id")
    .eq("restaurant_id", parsed.restaurantId)
    .eq("user_id", parsed.staffUserId)
    .single();

  if (!membership) throw new Error("Staff member not found for this restaurant.");

  const temporaryPassword = generateTemporaryPassword();

  const { error } = await supabase.auth.admin.updateUserById(parsed.staffUserId, {
    password: temporaryPassword,
  });
  if (error) throw new Error(error.message);

  // See deactivateStaffMember above for why this goes through the RPC
  // rather than supabase.auth.admin.signOut() — that call takes a JWT,
  // not a user id.
  const { error: forceLogoutError } = await supabase.rpc("force_logout_user", { target_user_id: parsed.staffUserId });
  if (forceLogoutError) {
    console.error("[staff] credential reset but force-logout failed", parsed.staffUserId, forceLogoutError);
  }

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "staff.credential_reset",
    targetTable: "restaurant_staff",
    targetId: parsed.staffUserId,
    restaurantId: parsed.restaurantId,
    reason: "Vendor Admin-initiated credential reset.",
  });

  return { temporaryPassword };
}
