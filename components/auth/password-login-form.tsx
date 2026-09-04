"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import type { AppRole } from "@/lib/auth/roles";

/**
 * Email + password login shared by Vendor Admin, Staff and Super Admin
 * (SRS §3: "Vendor/Admin/Staff role-controlled authentication"). Customers
 * never see this form — they use phone OTP (app/auth/customer).
 *
 * After a successful Supabase Auth sign-in, this checks the caller's
 * actual `profiles.role` matches the role this login surface is for, and
 * signs them back out if not — a vendor admin's credentials must not grant
 * entry to /staff or /admin just because the password was correct
 * (SRS §17: role must be checked server-side/authoritatively, not assumed
 * from which login page was used).
 */
export function PasswordLoginForm({
  expectedRole,
  redirectTo,
}: {
  expectedRole: AppRole;
  redirectTo: string;
}) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError || !data.session) {
      setLoading(false);
      setError("Invalid email or password.");
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, status")
      .eq("id", data.session.user.id)
      .single();

    if (!profile || profile.status !== "active" || profile.role !== expectedRole) {
      await supabase.auth.signOut();
      setLoading(false);
      setError("This account does not have access here.");
      return;
    }

    setLoading(false);
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
      <input
        type="email"
        required
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="rounded-brand border border-cream-300 bg-cream-50 px-4 py-2.5"
      />
      <input
        type="password"
        required
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="rounded-brand border border-cream-300 bg-cream-50 px-4 py-2.5"
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={loading}>
        {loading ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
