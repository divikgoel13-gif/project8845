"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Vendor Admin self-service password change (SRS Phase 4, §10 "Vendor
 * Admin access/profile controls"). This is a self-change by the already-
 * authenticated account holder, not a role/credential grant — it doesn't
 * touch the "no self-service signup for elevated roles" rule in
 * docs/AUTH_RBAC.md, which is about who can CREATE a vendor_admin/staff
 * account in the first place, not whether an existing, already-verified
 * one can change its own password. `supabase.auth.updateUser` requires
 * an active session, which is exactly the access-control boundary here.
 */
export function ChangePasswordForm() {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);

    if (newPassword.length < 8) {
      setStatus({ ok: false, message: "Password must be at least 8 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus({ ok: false, message: "Passwords don't match." });
      return;
    }

    setLoading(true);
    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);

    if (error) {
      setStatus({ ok: false, message: error.message });
      return;
    }

    setStatus({ ok: true, message: "Password updated." });
    setNewPassword("");
    setConfirmPassword("");
  }

  return (
    <Card>
      <h2 className="font-display font-semibold">Change password</h2>
      <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
        <label className="text-sm font-medium">
          New password
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="mt-1 w-full rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
            required
            minLength={8}
          />
        </label>
        <label className="text-sm font-medium">
          Confirm new password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-1 w-full rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
            required
            minLength={8}
          />
        </label>
        <Button type="submit" disabled={loading} className="self-start">
          {loading ? "Updating…" : "Update password"}
        </Button>
        {status && (
          <p className={`text-sm ${status.ok ? "text-success" : "text-danger"}`}>{status.message}</p>
        )}
      </form>
    </Card>
  );
}
