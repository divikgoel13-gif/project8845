import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

/**
 * Request-scoped server client — runs as the signed-in user, subject to
 * RLS, using their session cookie. Use this for the vast majority of
 * server-side reads and any write that RLS is meant to gate (SRS §3:
 * "Backend: Next.js Server Actions/Route Handlers and server-side Supabase
 * clients for privileged operations").
 */
export function createServerSupabaseClient() {
  const cookieStore = cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Called from a Server Component render — safe to ignore when
            // middleware is refreshing the session (see middleware.ts).
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // See note above.
          }
        },
      },
    }
  );
}

/**
 * Service-role client — bypasses RLS entirely. This is a DELIBERATE,
 * narrow trust boundary, not a convenience shortcut. Every call site that
 * uses this client is doing something RLS structurally cannot express
 * (e.g. writing an order-state transition after validating server-side
 * business rules, processing a Razorpay webhook with no user session,
 * resetting a Vendor Admin's credentials, writing an audit log entry).
 *
 * RULES for anyone importing this (see SRS §17):
 *   - NEVER import this in a Client Component or expose it to the browser.
 *   - NEVER use it as a shortcut to skip writing an RLS policy.
 *   - Every call site should re-validate the caller's authorization itself
 *     (e.g. "is this actually a super_admin?") before mutating anything —
 *     bypassing RLS does not mean bypassing authorization checks.
 *   - SUPABASE_SERVICE_ROLE_KEY must never be prefixed with NEXT_PUBLIC_.
 */
export function createServiceRoleSupabaseClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
