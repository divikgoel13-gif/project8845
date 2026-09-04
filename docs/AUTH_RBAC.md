# Authentication & RBAC — UNI8

Current through Phase 8B. Phase 9C changes the customer channel (V2.6 §62
replaces phone+OTP with a password credential) — until that lands, the table
below is the live behaviour.

## Authentication channels (SRS §1.1, §3)

| Role | Channel | Where |
|---|---|---|
| Customer | Phone number + OTP (Supabase Auth phone provider) | `app/auth/customer/page.tsx` |
| Vendor Admin | Email + password (Supabase Auth) | `app/auth/vendor/page.tsx` |
| Staff | Email + password (Supabase Auth) | `app/auth/staff/page.tsx` |
| Super Admin | Email + password (Supabase Auth) | `app/auth/admin/page.tsx` |

Customers never get a password. Vendor/Staff/Admin never use OTP. This is a
hard SRS requirement (§1.1) and is enforced structurally — the customer
login page never renders a password field, and the vendor/staff/admin login
pages never render a phone/OTP field.

A single shared `PasswordLoginForm` component
(`components/auth/password-login-form.tsx`) is parameterized with an
`expectedRole` — after Supabase Auth confirms the password is correct, the
form independently checks `profiles.role` matches, and signs the user back
out (invalidating the session) if it doesn't. **Correct credentials alone
never grant access to the wrong role's area.**

## Why `profiles.role` is a single column but access is NOT single-flag

`profiles.role` answers "what kind of person is this" for routing/UX
purposes (which login page, which nav). It does **not** by itself answer
"can this vendor_admin touch Restaurant X" — that's answered by
`vendor_admin_memberships` / `restaurant_staff`, which are per-restaurant
grant rows with a `disabled_at` column Super Admin controls (SRS §8: create,
disable/reactivate, force logout, reset credential — all Super-Admin-only
actions).

A vendor_admin with memberships at Restaurant A and Restaurant C can act on
both; a vendor_admin with a membership only at Restaurant A gets a
`ForbiddenError` from `requireRestaurantScope()` — and a matching RLS denial
even if the guard were somehow bypassed — the moment they try to touch
Restaurant B.

## Role escalation is blocked at the database level, not just the UI

`profiles_update_self` (RLS) lets any user update their own row — this is
needed so a customer can edit their name/email/course, or a vendor admin can
update their display name. Without anything else, that policy would also
let a client-side `UPDATE profiles SET role = 'super_admin' WHERE id =
auth.uid()` succeed. The `trg_prevent_self_role_escalation` trigger
(`0007_functions_and_triggers.sql`) closes that gap: any attempted change to
`role` or `status` in an UPDATE is rejected with an `insufficient_privilege`
error unless the actor is already `is_super_admin()`.

## Granting an elevated role (vendor_admin / staff / super_admin)

There is no self-service signup for these roles. The flow is:

1. Super Admin creates the person's Supabase Auth account (email+password)
   via the Auth Admin API — see `scripts/seed-auth-users.ts` for the pattern
   this should follow in a real "Create Vendor Admin" Server Action.
2. The `handle_new_auth_user` trigger creates a `profiles` row with
   `role = 'customer'` by default.
3. A Super-Admin-only Server Action (using the service-role client) updates
   that row's `role` and creates the relevant membership row
   (`vendor_admin_memberships` or `restaurant_staff`), and records an audit
   event.

Phase 4 built the vendor-side "Create Staff" UI on this pattern
(`lib/actions/vendor/staff.ts`), and Phase 7 built the Super Admin side
(`lib/actions/admin/restaurant-access.ts`): `grantRestaurantAccess()`,
`revokeRestaurantAccess()` and `setProfileStatus()`, each of them
`requireSuperAdmin()` → service-role write → `recordAuditEvent()`.

## Route protection summary

```
middleware.ts             → fast redirect by role-prefix (UX only)
app/(role)/…/layout.tsx   → requireRole() makes the whole subtree unreachable
lib/auth/guards.ts        → requireProfile / requireRole / requireSuperAdmin /
                            requireRestaurantScope
                            (called inside every page, Server Action, Route Handler)
RLS policies              → the actual enforcement floor
```

See `docs/ARCHITECTURE.md` "Authorization: three independent layers" for
the full rationale.

## The Super Admin surface (Phase 7–8)

Every route under `app/(admin)/admin/` is covered twice: the route-group layout
calls `requireRole("super_admin")`, and each page, action and `export/route.ts`
calls `requireSuperAdmin()` again. The second call is the one that matters —
layouts are a rendering convenience, not an authorization boundary, and an
export Route Handler is reachable by URL without any layout running at all.

Three properties of that surface are load-bearing:

- **Customers never reach the internal CRM.** SRS §13 is explicit. The
  `/admin/customers` Customer 360, internal notes, customer flags and grievance
  internal notes are super-admin-only at the guard *and* at RLS. A customer's own
  view of their ticket (`/support/[ticketId]`) is a different reader
  (`lib/data/customer-grievances.ts`) that never selects internal-note rows.
- **Vendor admins get no grievance attachments**, not even on their own
  restaurant's tickets — enforced in `0018` Storage policies, not in the UI.
- **Suspension is one mechanism.** `profiles.status` is the only account-level
  suspension; `setProfileStatus()` (staff/vendor) and
  `setCustomerAccountStatus()` (customer) both write that column and nothing
  else, so there is no second, divergent notion of "disabled". Per-restaurant
  revocation is separate and uses the membership `disabled_at` column.

## Customer-owned resources: guard plus explicit ownership

`requireRole()` answers "is this a customer". It does not answer "is this
*that* customer's ticket", and the Phase 8 customer actions run under the
service-role client, where RLS is not there to catch the difference. So every
customer action re-checks ownership itself, e.g. in
`lib/actions/customer/grievance.ts`:

```ts
const profile = await requireProfile();
// …fetch ticket by id…
if (ticket.requester_id !== profile.id || ticket.requester_role !== "customer") {
  throw new Error("Ticket not found.");
}
```

Two details are deliberate. The role is compared as well as the id, because
`requester_id` is also used for vendor-raised tickets and a shared id space
should not become a shared access space. And the failure message says "not
found" rather than "not yours", so the endpoint is not an existence oracle for
other people's ticket ids.

Attachment paths get the same treatment one level down:
`parseAttachmentPaths(ticketId, paths)` refuses any path outside
`ticket/<this ticket>/` before a `grievance_attachments` row is written, because
otherwise a caller could bind a row to somebody else's upload and the ticket page
would dutifully sign a URL for it.

## Force logout and credential reset

Both exist, at the vendor scope. `0014_force_logout_function.sql` provides
`force_logout_user(target_user_id)` — a `SECURITY DEFINER` function that deletes
the user's `auth.refresh_tokens` rows, because supabase-js's
`auth.admin.signOut()` takes a session JWT, not a user id. `EXECUTE` is revoked
from `public`/`anon`/`authenticated`, so only a service-role Server Action can
call it. `lib/actions/vendor/staff.ts` calls it on both deactivation and
credential reset, and logs rather than throws if it fails — the deactivation
itself has already succeeded and must not be rolled back.

**Still missing (tracked in `docs/KNOWN_ISSUES.md`):** the Super Admin has no
force-logout / credential-reset UI of its own; it can suspend via
`setProfileStatus()`, but the equivalent of the vendor flow belongs on the
Phase 9A Staff & Access screen. Also unrecorded: `last_login_at` and QR mint
time, which the §8 "recent activity" line wants.

## Restaurant-scoped authorization in practice (Phase 3 example)

`requireRestaurantScope()` is the pattern every vendor_admin/staff action
follows — QR scanning (Phase 3) is a good concrete example:
`lib/actions/restaurant/scan.ts#submitScan` accepts a `restaurantId` from
the client (which restaurant's scan screen the staff member is on), but
never trusts it directly. It calls `requireRestaurantScope(restaurantId)`
first, which re-verifies an ACTIVE `restaurant_staff` or
`vendor_admin_memberships` row exists for *this specific user* and *this
specific restaurant* — then `lib/orders/scan.ts#resolveOrderForRestaurant`
filters by that same `restaurantId` a second time when resolving the
scanned QR token, so even if the guard were somehow bypassed, a
restaurant-scoped query still couldn't return another restaurant's order.
Two independent checks for the same fact, on purpose.
