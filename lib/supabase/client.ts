import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

/**
 * Browser-side Supabase client. Uses the anon key only — every table this
 * client can touch is protected by RLS (see supabase/migrations/0006_rls_policies.sql).
 *
 * Architecture principle (SRS §3): "The browser is never trusted for
 * authorization, price, order totals, payment state, QR validity or
 * privileged changes." This client is for reads the current user is
 * genuinely allowed to see, and for the narrow set of writes RLS itself
 * permits (e.g. a customer inserting into their own cart). Anything
 * privileged goes through a Server Action using lib/supabase/server.ts.
 */
export function createBrowserSupabaseClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
