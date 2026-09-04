"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  grantRestaurantAccess,
  revokeRestaurantAccess,
  setProfileStatus,
  forceLogoutUser,
} from "@/lib/actions/admin/restaurant-access";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, FormError, FormSuccess } from "@/components/ui/field";

/**
 * Access-grant islands (SRS §8 access control, §11 five-staff cap, V2.6 §60).
 *
 * Two separate components because granting and revoking have different shapes and
 * different consequences. A grant is a picker; a revocation demands a typed reason,
 * so it cannot be a single button in a table row.
 *
 * The candidate list is passed in already filtered to profiles that hold the role
 * being granted. This console grants ACCESS to a restaurant, it does not change
 * what someone is — so there is deliberately no way to turn a customer into staff
 * from here, and the empty candidate list says so rather than offering a workaround.
 */

type Candidate = { id: string; name: string | null; email: string | null; phone: string | null };

function candidateLabel(c: Candidate): string {
  const contact = c.email ?? c.phone ?? "no contact on file";
  return c.name ? `${c.name} — ${contact}` : contact;
}

/**
 * `atCap` is computed by the page from the count of ACTIVE grants and passed in,
 * rather than being derived here, because the authority is the `enforce_staff_limit`
 * trigger in migration 0006. This control only stops the operator earlier so they
 * get a sentence instead of a database error.
 */
export function GrantAccessForm({
  restaurantId,
  role,
  candidates,
  atCap,
}: {
  restaurantId: string;
  role: "vendor_admin" | "staff";
  candidates: Candidate[];
  atCap?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [userId, setUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const noun = role === "staff" ? "staff member" : "vendor admin";

  function submit() {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const result = await grantRestaurantAccess({ restaurantId, userId, role });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(`Access granted. The ${noun} can sign in to this restaurant immediately.`);
      setUserId("");
      router.refresh();
    });
  }

  if (atCap) {
    return (
      <p className="rounded-brand bg-warning-bg px-3 py-2 text-xs text-warning">
        This restaurant already has the maximum of five active staff members. Revoke an existing grant before adding
        another — the limit is enforced by the database, not just by this page.
      </p>
    );
  }

  if (candidates.length === 0) {
    return (
      <p className="text-xs text-ink-muted">
        {`No eligible accounts. Only an active profile whose role is already ${role.replace("_", " ")} can be granted
        this access, because granting access does not change what someone is. Create the account with the correct role
        first.`}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label={`Grant to`} htmlFor={`grant-${role}`} className="max-w-md" hint="Active accounts with this role">
        <Select id={`grant-${role}`} value={userId} onChange={(event) => setUserId(event.currentTarget.value)}>
          <option value="">Select an account…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {candidateLabel(c)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="pb-1">
        <Button type="button" size="sm" onClick={submit} disabled={pending || !userId}>
          {pending ? "Granting…" : "Grant access"}
        </Button>
      </div>
      <div className="pb-1">
        {saved ? <FormSuccess>{saved}</FormSuccess> : null}
        <FormError>{error}</FormError>
      </div>
    </div>
  );
}

/**
 * Row actions for one existing grant.
 *
 * Both actions require a typed reason, so both expand inline rather than firing on
 * click. A confirm dialog was rejected: §8 wants the reason recorded in the audit
 * entry, and a dialog that only asks "are you sure" records nothing.
 *
 * The two actions are deliberately different weights and are labelled so:
 * revoking removes this restaurant's access, while disabling the account locks the
 * person out of the entire platform including any other restaurant they work at.
 */
export function AccessRowActions({
  restaurantId,
  role,
  userId,
  isRevoked,
  profileStatus,
}: {
  restaurantId: string;
  role: "vendor_admin" | "staff";
  userId: string;
  isRevoked: boolean;
  profileStatus: "active" | "disabled";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<null | "revoke" | "status">(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    startTransition(async () => {
      const result =
        mode === "revoke"
          ? await revokeRestaurantAccess({ restaurantId, userId, role, reason })
          : await setProfileStatus({
              userId,
              status: profileStatus === "active" ? "disabled" : "active",
              reason,
              restaurantId,
            });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMode(null);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="min-w-[12rem]">
      {mode === null ? (
        <div className="flex flex-wrap items-center gap-2">
          {isRevoked ? null : (
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode("revoke")}>
              Revoke
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={() => setMode("status")}>
            {profileStatus === "active" ? "Disable account" : "Re-enable account"}
          </Button>
        </div>
      ) : (
        <div>
          <Field
            label="Reason"
            htmlFor={`reason-${userId}-${mode}`}
            required
            hint={
              mode === "revoke"
                ? "Recorded against this restaurant only"
                : "Platform-wide. Affects every restaurant this account works at."
            }
          >
            <Input
              id={`reason-${userId}-${mode}`}
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.currentTarget.value)}
            />
          </Field>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="danger"
              onClick={run}
              disabled={pending || reason.trim().length === 0}
            >
              {pending ? "Saving…" : mode === "revoke" ? "Confirm revoke" : "Confirm"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setMode(null);
                setReason("");
                setError(null);
              }}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      <FormError>{error}</FormError>
    </div>
  );
}

/**
 * Grant access WITHOUT already being inside a restaurant's workspace (SRS
 * Phase 9 "Global Staff & Access centre"). The restaurant-scoped
 * `GrantAccessForm` above assumes the page already knows which restaurant —
 * this is the same action with one more field, so an operator who knows WHO
 * they want to grant access to, but not which of fourteen restaurant
 * workspaces to open first, can do it from one screen.
 *
 * The five-staff cap is deliberately not pre-computed per restaurant here
 * (unlike the workspace form's `atCap` prop) — that would mean fetching
 * every restaurant's active-staff count just to grey out a select option.
 * `grantRestaurantAccess` already enforces the cap server-side and returns a
 * plain-English error either way, so this form lets the server be the one
 * source of truth rather than approximating it twice.
 */
export function GlobalGrantAccessForm({
  role,
  restaurantOptions,
  candidates,
}: {
  role: "vendor_admin" | "staff";
  restaurantOptions: { id: string; name: string }[];
  candidates: Candidate[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [restaurantId, setRestaurantId] = useState("");
  const [userId, setUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const noun = role === "staff" ? "staff member" : "vendor admin";

  function submit() {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const result = await grantRestaurantAccess({ restaurantId, userId, role });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(`Access granted. The ${noun} can sign in to that restaurant immediately.`);
      setRestaurantId("");
      setUserId("");
      router.refresh();
    });
  }

  if (candidates.length === 0) {
    return (
      <p className="text-xs text-ink-muted">
        {`No eligible accounts. Only an active profile whose role is already ${role.replace("_", " ")} can be granted
        this access — create the account with the correct role first.`}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Restaurant" htmlFor={`grant-restaurant-${role}`} className="max-w-xs">
        <Select
          id={`grant-restaurant-${role}`}
          value={restaurantId}
          onChange={(event) => setRestaurantId(event.currentTarget.value)}
        >
          <option value="">Select a restaurant…</option>
          {restaurantOptions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Grant to" htmlFor={`grant-person-${role}`} className="max-w-md" hint="Active accounts with this role">
        <Select id={`grant-person-${role}`} value={userId} onChange={(event) => setUserId(event.currentTarget.value)}>
          <option value="">Select an account…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {candidateLabel(c)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="pb-1">
        <Button type="button" size="sm" onClick={submit} disabled={pending || !userId || !restaurantId}>
          {pending ? "Granting…" : "Grant access"}
        </Button>
      </div>
      <div className="pb-1">
        {saved ? <FormSuccess>{saved}</FormSuccess> : null}
        <FormError>{error}</FormError>
      </div>
    </div>
  );
}

/**
 * Standalone session kill (SRS §8's "force logout actions"), independent of
 * revoking access or disabling the account. No reason field and no
 * confirmation step — matching `GrantAccessForm`'s weight, not
 * `AccessRowActions`'s — because forcing a session out is fully reversible
 * (the person can simply log back in) rather than a trust decision that
 * needs a documented reason.
 */
export function ForceLogoutButton({ userId, restaurantId }: { userId: string; restaurantId?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await forceLogoutUser({ userId, restaurantId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
      router.refresh();
    });
  }

  return (
    <div>
      <Button type="button" size="sm" variant="ghost" onClick={run} disabled={pending || done}>
        {pending ? "Ending session…" : done ? "Session ended" : "Force logout"}
      </Button>
      <FormError>{error}</FormError>
    </div>
  );
}
