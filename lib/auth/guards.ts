import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AppRole, AuthenticatedProfile } from "@/lib/auth/roles";

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not authenticated.");
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Not authorized for this action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Loads the current caller's profile from the session cookie. Throws if
 * there's no session or the profile is disabled — callers should let this
 * propagate to a Server Action error boundary rather than swallowing it.
 *
 * This is the FIRST line of every privileged Server Action / Route
 * Handler (SRS §17: "Server must re-check authorization for every
 * mutation"). Middleware's role check is a fast UX redirect, not a
 * substitute for this.
 */
export async function requireProfile(): Promise<AuthenticatedProfile> {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new UnauthenticatedError();

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, status, name, email, phone")
    .eq("id", user.id)
    .single();

  if (error || !profile || profile.status !== "active") {
    throw new UnauthenticatedError();
  }

  return profile as AuthenticatedProfile;
}

export async function requireRole(role: AppRole): Promise<AuthenticatedProfile> {
  const profile = await requireProfile();
  if (profile.role !== role) {
    throw new ForbiddenError(`This action requires role "${role}".`);
  }
  return profile;
}

/**
 * Verifies the current vendor_admin/staff user actually has an ACTIVE
 * membership scoped to the given restaurant — never trust a restaurantId
 * passed from the client without this check (SRS §17: "Never trust
 * client-submitted... restaurant IDs").
 */
export async function requireRestaurantScope(
  restaurantId: string,
  allowedRoles: Array<"vendor_admin" | "staff"> = ["vendor_admin", "staff"]
): Promise<AuthenticatedProfile> {
  const profile = await requireProfile();

  if (!allowedRoles.includes(profile.role as "vendor_admin" | "staff")) {
    throw new ForbiddenError();
  }

  const supabase = createServerSupabaseClient();
  const table = profile.role === "vendor_admin" ? "vendor_admin_memberships" : "restaurant_staff";

  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("user_id", profile.id)
    .eq("restaurant_id", restaurantId)
    .is("disabled_at", null)
    .maybeSingle();

  if (error || !data) {
    throw new ForbiddenError("You do not have access to this restaurant.");
  }

  return profile;
}

/** Convenience guard for Super-Admin-only Server Actions. */
export async function requireSuperAdmin(): Promise<AuthenticatedProfile> {
  return requireRole("super_admin");
}
