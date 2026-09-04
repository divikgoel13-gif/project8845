"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  createStaffMember,
  deactivateStaffMember,
  reactivateStaffMember,
  resetStaffCredential,
} from "@/lib/actions/vendor/staff";
import type { VendorStaffMember } from "@/lib/data/vendor-staff";

const MAX_ACTIVE_STAFF = 5; // SRS §11 — mirrored here for UI copy only; the DB trigger is the real enforcement.

/**
 * Vendor Admin "Manage Staff" page interactivity (SRS Phase 4, §10:
 * "Create/deactivate/reactivate up to 5 active staff; view credentials
 * through secure reset flow; view activity"). See the doc comment at the
 * top of lib/actions/vendor/staff.ts for why this page — not just Super
 * Admin — can create staff for this restaurant.
 */
export function StaffManager({
  restaurantId,
  staff: initialStaff,
}: {
  restaurantId: string;
  staff: VendorStaffMember[];
}) {
  const [staff, setStaff] = useState(initialStaff);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [revealedCredential, setRevealedCredential] = useState<{ email: string; password: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const activeCount = staff.filter((s) => !s.disabledAt).length;

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await createStaffMember({ restaurantId, name: name.trim(), email: email.trim() });
        setStaff((prev) => [
          ...prev,
          {
            userId: result.userId,
            name: name.trim(),
            email: result.email,
            createdAt: new Date().toISOString(),
            disabledAt: null,
            recentActivity: [],
          },
        ]);
        setRevealedCredential({ email: result.email, password: result.temporaryPassword });
        setName("");
        setEmail("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not create staff member.");
      }
    });
  }

  function handleDeactivate(staffUserId: string) {
    setStaff((prev) => prev.map((s) => (s.userId === staffUserId ? { ...s, disabledAt: new Date().toISOString() } : s)));
    startTransition(async () => {
      try {
        await deactivateStaffMember({ restaurantId, staffUserId });
      } catch (e) {
        setStaff((prev) => prev.map((s) => (s.userId === staffUserId ? { ...s, disabledAt: null } : s)));
        setError(e instanceof Error ? e.message : "Could not deactivate staff member.");
      }
    });
  }

  function handleReactivate(staffUserId: string) {
    setError(null);
    startTransition(async () => {
      try {
        await reactivateStaffMember({ restaurantId, staffUserId });
        setStaff((prev) => prev.map((s) => (s.userId === staffUserId ? { ...s, disabledAt: null } : s)));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not reactivate staff member.");
      }
    });
  }

  function handleResetCredential(staffUserId: string, email: string | null) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await resetStaffCredential({ restaurantId, staffUserId });
        setRevealedCredential({ email: email ?? "this account", password: result.temporaryPassword });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not reset credentials.");
      }
    });
  }

  return (
    <div>
      {revealedCredential && (
        <Card className="mb-4 border-orange-300 bg-orange-50">
          <p className="text-sm font-semibold text-ink">
            Temporary password for {revealedCredential.email}
          </p>
          <p className="mt-1 font-mono text-sm">{revealedCredential.password}</p>
          <p className="mt-2 text-xs text-ink-muted">
            Copy this now and hand it to them directly — it will not be shown again.
          </p>
          <button
            onClick={() => setRevealedCredential(null)}
            className="mt-2 text-xs font-medium text-orange-700 underline"
          >
            Dismiss
          </button>
        </Card>
      )}

      {error && <p className="mb-4 rounded-brand bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}

      <Card>
        <h2 className="font-display font-semibold">Add staff member</h2>
        <p className="mt-1 text-xs text-ink-muted">
          {activeCount} of {MAX_ACTIVE_STAFF} active staff slots used.
        </p>
        <form onSubmit={handleCreate} className="mt-3 flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
            required
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
            required
          />
          <Button type="submit" disabled={isPending || activeCount >= MAX_ACTIVE_STAFF}>
            {isPending ? "Adding…" : "Add staff"}
          </Button>
        </form>
        {activeCount >= MAX_ACTIVE_STAFF && (
          <p className="mt-2 text-xs text-danger">
            This restaurant has reached the {MAX_ACTIVE_STAFF}-active-staff limit — deactivate someone to add another.
          </p>
        )}
      </Card>

      <Card className="mt-6">
        <h2 className="font-display font-semibold">Staff</h2>
        {staff.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">No staff added yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Email</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Recent activity</th>
                <th className="pb-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.userId} className="border-t border-cream-300 align-top">
                  <td className="py-2">{s.name ?? "—"}</td>
                  <td className="py-2 text-ink-soft">{s.email ?? "—"}</td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        s.disabledAt ? "bg-danger-bg text-danger" : "bg-success-bg text-success"
                      }`}
                    >
                      {s.disabledAt ? "Deactivated" : "Active"}
                    </span>
                  </td>
                  <td className="py-2 text-xs text-ink-muted">
                    {s.recentActivity.length === 0
                      ? "No recorded activity yet."
                      : s.recentActivity.map((a) => a.action).join(", ")}
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-2">
                      {s.disabledAt ? (
                        <button
                          onClick={() => handleReactivate(s.userId)}
                          disabled={isPending || activeCount >= MAX_ACTIVE_STAFF}
                          className="text-sm font-medium text-orange-600 underline disabled:opacity-50"
                        >
                          Reactivate
                        </button>
                      ) : (
                        <button
                          onClick={() => handleDeactivate(s.userId)}
                          disabled={isPending}
                          className="text-sm font-medium text-danger underline"
                        >
                          Deactivate
                        </button>
                      )}
                      <button
                        onClick={() => handleResetCredential(s.userId, s.email)}
                        disabled={isPending}
                        className="text-sm font-medium text-ink-soft underline"
                      >
                        Reset credentials
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
