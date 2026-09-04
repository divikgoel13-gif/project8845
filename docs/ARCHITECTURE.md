# Architecture — UNI8

Current through **Phase 8B** (Developer 3's second block). Phases 1–3 built the
foundation, ordering and payments; 4–6 the vendor and staff surfaces; 7 the
Super Admin command center and restaurant workspaces; 8A/8B the Customer 360
and central grievance CRMs. Phase 9 (analytics, platform settings, audit/fraud
UI, customer auth changes, notification centre UI) is not built — see
`docs/PHASE_STATUS.md` for what exists per phase and `docs/KNOWN_ISSUES.md`
for what is deferred.

## Stack (SRS §3)

| Layer | Choice |
|---|---|
| Framework | Next.js 14 App Router + TypeScript |
| Database | Supabase PostgreSQL |
| Auth | Supabase Auth — customer: phone+OTP; vendor/staff/admin: email+password |
| Authorization | RBAC + restaurant-scoped membership tables + PostgreSQL RLS |
| Storage | Supabase Storage — public (product images, branding) vs private (grievance attachments, payout proofs) buckets |
| Payments | Razorpay (Phase 3) |
| Backend | Next.js Server Actions + Route Handlers, server-side Supabase clients |

## Route structure

Four role-scoped route groups, each gated by `middleware.ts`:

- `app/(customer)/...` — no route-group prefix requirement beyond specific
  paths (`/account`, `/cart`, `/checkout`, `/orders`, `/support`) needing *any*
  authenticated customer. Discovery (`/`, `/restaurants`) is intentionally
  public — SRS §9 Discovery does not require login to browse.
- `app/(vendor)/vendor/...` — requires `profiles.role = 'vendor_admin'`.
- `app/(staff)/staff/...` — requires `profiles.role = 'staff'`, and is
  intentionally limited to exactly two pages (Orders, Scan) per SRS §11.
- `app/(admin)/admin/...` — requires `profiles.role = 'super_admin'`.

Route GROUPS (the parenthesized folders) don't affect the URL — they exist so
each role's pages share a layout without polluting the URL structure. As of
Phase 7 three of them have real chrome: `app/(vendor)/vendor/layout.tsx`,
`app/(staff)/staff/layout.tsx` and `app/(admin)/admin/layout.tsx`. Each layout
calls `requireRole()` itself, so the whole subtree is unreachable to the wrong
role even before a page's own guard runs.

## Admin surface (Phase 7–8)

`app/(admin)/admin/layout.tsx` is a transcription of the SRS §5.1 navigation
table — three groups (COMMAND CENTER, PLATFORM, CONTROL), exactly twelve
destinations, nothing added beside them. V2/V2.6 additions live *under* the
twelve rather than as new top-level entries, because §5 opens by rejecting a
flat control surface. Six of the twelve hrefs point at Phase 9 routes that do
not exist yet (`/admin/analytics`, `/admin/settings`, `/admin/audit`,
`/admin/audit/fraud`, `/admin/staff-access`, `/admin/menus`); the static
verifier's `routes` check reports them and that is expected.

Two shapes of screen:

- **Global**: `dashboard` (five bands, `revalidate = 30`), `operations` (V2 §F
  Live Ops, all eleven alert classes, `revalidate = 15`), `orders` (+ `[id]`,
  `export/route.ts`), `restaurants` (+ `new`), `customers` (+ `[customerId]`,
  `export`), `grievances` (+ `[id]`, `export`), `payments` (+
  `[restaurantId]`).
- **Restaurant-scoped**: the fourteen-tab workspace under
  `restaurants/[restaurantId]/` — dashboard, orders, menu, products, pickup,
  walking-times, staff, vendor-admins, settings, payments, disbursements,
  grievances, ratings, audit. Its `layout.tsx` resolves the restaurant once
  (`lib/admin/restaurant-context.ts`) so fourteen pages do not each re-resolve
  it, and fetches no page data of its own so a slow aggregate cannot delay the
  navigation from rendering.

Read models live in `lib/admin/` (`dashboard`, `live-ops`, `orders`,
`restaurants`, `restaurant-context`, `restaurant-workspace`, `customers`,
`grievances`, plus `csv` and `format` helpers); writes live in
`lib/actions/admin/` (`restaurants`, `restaurant-access`, `restaurant-catalog`,
`restaurant-pickup`, `walking-times`, `update-commission-rate`, `disburse`,
`refund`, `live-ops`, `customers`, `grievance`). Platform-wide configuration
reads/writes go through `lib/platform/` (`settings`, `feature-flags`,
`maintenance`, `announcements`).

`assertNotInMaintenance()` (`lib/platform/maintenance.ts`) is called by write
actions rather than by the admin layout. V2.6 §R requires existing paid orders
to remain reachable during maintenance, and an admin-wide gate would lock the
operator away from the switch that turns maintenance off.

Exports are Route Handlers (`export/route.ts`) rather than client-side CSV
generation, so the guard and the row-level filtering that produced the on-screen
list also produce the file. Grievance CSV deliberately omits message bodies —
see `docs/PHASE_STATUS.md` Phase 8B.

## Authorization: three independent layers

1. **`middleware.ts`** — runs on every request, refreshes the Supabase
   session cookie, and does a fast role-prefix redirect
   (`/admin/* ` → must be `super_admin`, etc.). This is a UX optimization —
   it stops an obviously-wrong-role user before any page code runs — but it
   is NOT the authorization boundary.

2. **`lib/auth/guards.ts`** — `requireProfile()` / `requireRole()` /
   `requireSuperAdmin()` / `requireRestaurantScope()`. Every Server Action and
   Route Handler that does anything privileged calls one of these FIRST, and
   `requireRestaurantScope()` specifically re-verifies an ACTIVE membership
   row exists for the restaurant ID in question — never trust a
   `restaurantId` that arrived from a client (SRS §17). Customer-owned
   resources use `requireProfile()` plus an explicit ownership comparison
   inside the action, because "is a logged-in customer" is not "is *this*
   customer".

3. **PostgreSQL RLS** — `0006_rls_policies.sql` for Phases 1–6 and
   `0017_phase7_9_rls.sql` for everything Phases 7–9 added. This is
   the actual enforcement floor: even if a Server Action had a bug and
   skipped a guard, or someone queried the database directly with the
   anon key, RLS still blocks unauthorized reads/writes. Every table is
   `enable` **and** `force row level security`, so not even the table owner
   slips past. Helper functions
   (`is_super_admin()`, `is_active_vendor_admin_for()`,
   `is_active_staff_for()`, `my_restaurant_ids()`) live in
   `0005_rls_helper_functions.sql` and are `SECURITY DEFINER` so policies
   on `profiles` itself don't recurse.

None of these three layers assumes the others are correct. This is
deliberate defense in depth per SRS §17.

## Order state machine (SRS §14)

`orders.status` is a Postgres enum. There is **no client-writable UPDATE
policy on `orders`** (see the comment block in `0006_rls_policies.sql`) —
every status transition happens via a Server Action using the service-role
client, after that action has independently validated the transition is
legal.

As of Phase 3, this is implemented as `lib/orders/transitionOrder()`
(`lib/orders/state-machine.ts`), the single helper every order-mutating
Server Action uses — no code path hand-rolls its own
`UPDATE orders SET status = ...`. It has two properties worth
understanding:

1. **Transition validity** is checked against `ORDER_STATUS_TRANSITIONS`
   before attempting the write.
2. **Optimistic concurrency**: the UPDATE's `WHERE` clause requires the
   row to still be in the expected `fromStatus`. If two calls race (two
   near-simultaneous QR scans, a webhook and a client-verify path both
   finalizing the same payment), only one UPDATE actually matches a row —
   the other gets zero rows back and the caller turns that into a
   friendly "already collected" / "already processed" message rather than
   a silent double-transition.

This TypeScript table is DELIBERATELY mirrored by a Postgres trigger
(`enforce_order_status_transition`, `0011_order_state_machine_trigger.sql`)
as an independent third check — the same defense-in-depth philosophy as
authorization. If you change one, change the other; each file's comment
points back to the other.

## Payments & QR pickup (Phase 3 — SRS §12, §15, V2 §J/§K)

Full detail lives in `docs/PAYMENTS.md`. Summary of the pattern worth
knowing before touching this code:

- **One function, two entry points.** `lib/orders/finalize-payment.ts`'s
  `finalizePayment()` is the only place a Razorpay payment turns into
  confirmed orders. Both the webhook (`app/api/webhooks/razorpay/route.ts`,
  authoritative) and the client-side post-checkout verify action
  (`lib/actions/customer/verify-payment.ts`, a UX accelerant) call it —
  neither has its own separate order-creation logic, and the function
  itself re-fetches canonical payment state from Razorpay's API rather
  than trusting either caller's payload.
- **Orders exist before payment succeeds.** Matching SRS §14's explicit
  `payment_pending` state, `orders` rows (with `order_items` price/name
  snapshots and the commission snapshot) are created at checkout
  initiation, before the customer pays — not after. Capacity accounting
  (`lib/scheduling/capacity.ts`) deliberately excludes `payment_pending`
  orders so an abandoned checkout doesn't permanently block a slot.
- **One QR per checkout group, not per restaurant order.** SRS V2 §J's
  unified-QR model: `multi_order_groups.qr_token` is what's actually
  shown to the customer and scanned by every restaurant in that group.
  `lib/orders/scan.ts#resolveOrderForRestaurant` resolves the token to
  the GROUP, then looks up specifically the scanning restaurant's own
  order within it — Restaurant A can never see or collect Restaurant B's
  order through the same code path, regardless of which restaurant scans
  first.
- **QR fallback is phone-search, not a signed token.** A deliberate
  design deviation from the SRS's literal wording — see
  `docs/PAYMENTS.md` "QR fallback" for the reasoning.

## Financial integrity (SRS §11.5, §12, V2 §D)

- All money is **integer paise**. Never `numeric`/`float` for amounts.
- `orders.commission_rate_snapshot` / `commission_amount_paise` /
  `vendor_payable_paise` are written ONCE, at order-creation time (Phase 3),
  copying the current value of `admin_settings.commission_rate`. They are
  never recomputed from the live setting afterward.
- `admin_settings` is the only place `commission_rate` and
  `restaurant_cancellation_penalty_rate` live — see
  `0008_seed_platform_settings.sql`. `lib/actions/admin/update-commission-rate.ts`
  is the only sanctioned way to change the former, and it's fully audited.
- `restaurant_cancellation_events` is a separate ledger table from
  `orders`/`vendor_payables` — a cancellation penalty is its own financial
  event, never an edit to the original sale record.

## Audit logging (SRS §2, §6, §17)

`lib/audit/log.ts` → `recordAuditEvent()` is the only sanctioned writer to
`audit_logs`. There is no client-writable RLS policy on that table. Call it
from inside the same Server Action that performed the mutation, after the
mutation succeeds.

## Storage (SRS §3)

Bucket names are centralized in `lib/storage/buckets.ts`, and paths are always
built by `buildStoragePath()` — the Storage RLS policies read the *second path
segment* as the owning entity id, so a hand-written path is a security bug, not
a cosmetic one.

Buckets are provisioned by migration, not by dashboard clicks, so a fresh
environment is reproducible from `supabase/migrations/` alone:

| Bucket | Public | Provisioned in |
|---|---|---|
| `product-images` | yes | `0013_product_images_storage.sql` |
| `restaurant-branding` | yes | `0013_product_images_storage.sql` |
| `payout-proofs` | no | `0015_payout_proofs_storage.sql` |
| `grievance-attachments` | no | `0018_grievance_attachments_storage.sql` |

`0018` is worth reading before touching attachments. Its policies key off
`(string_to_array(name,'/'))[2]` = the ticket uuid, and they grant: Super Admin
full read/write; the *requester* read + insert on their own **non-terminal**
ticket; vendor admins nothing, even on their own restaurant's tickets, because a
customer's screenshot may contain their phone number or other orders (§13,
§7.2). There is no requester DELETE policy — §13 calls the timeline immutable.

The application side of that model (`lib/grievance/attachments.ts`) is the house
pattern for private files and is worth reusing verbatim:

1. **The browser uploads** straight to the bucket under the user's own session,
   so migration 0018's Storage RLS *is* the access check. Streaming a 3 MB photo
   through a Server Action would base64-inflate the request body for no security
   gain.
2. **A guarded Server Action writes the binding row.** The browser is not
   trusted with `grievance_attachments`; `parseAttachmentPaths(ticketId, paths)`
   throws unless every path is inside `ticket/<this ticket>/`, otherwise a caller
   could point a row at somebody else's upload and the ticket page would sign a
   URL for it. It throws rather than filtering silently — an attachment that
   vanishes without comment is worse than a failed reply.
3. **Reads are signed per render, 300 s TTL** (`signAttachmentPaths`), so no
   durable URL ever reaches the client.

Because 0018's policies need the ticket uuid in the path, attachments cannot be
added at ticket *creation* time — only on a reply. See `docs/KNOWN_ISSUES.md`
#23 for the staging-prefix fix, and its warning not to solve it by loosening the
`ticket/` policy.

## Migrations

`0001`–`0015` cover Phases 1–6 (extensions/enums, core tables, ordering and
financial tables, support and platform tables, RLS helpers and policies,
triggers, seeds, pickup capacity, the order state-machine trigger, security
hardening, and the first three buckets). Phases 7–8 added:

| Migration | Purpose |
|---|---|
| `0016_phase7_9_schema.sql` | Phase 7–9 tables and columns: ticket numbering, SLA columns, escalation/reopen/`closed_at`/CSAT, `grievance_assignments`, `grievance_templates`, platform flags/maintenance/announcements, customer flags |
| `0017_phase7_9_rls.sql` | RLS for everything 0016 added — same `enable` + `force row level security` discipline as 0006 |
| `0018_grievance_attachments_storage.sql` | Private `grievance-attachments` bucket + path-scoped policies (above) |
| `0019_admin_performance_indexes.sql` | Indexes for the global admin list/search screens; these queries are cross-restaurant by definition and were the only ones without a supporting index |
| `0020_v26_enum_additions.sql` | V2.6 enum values (additive — no enum value is ever removed) |
| `0021_v26_schema.sql` | V2.6 schema, including turning `notifications` into the §63 in-app object |
| `0022_phase8b_grievance_notifications.sql` | Seeds `grievance_opened` / `grievance_replied` in-app templates. Copy, not schema — §Y requires notification wording to be Super Admin-editable, so it must live in `notification_templates`, never hard-coded in `lib/notifications/in-app.ts`. Idempotent via `on conflict (key) do nothing` so an operator's edit survives a re-run |

Migrations are additive by policy: no destructive column drops, no enum value
removals, and archival instead of deletion (§P).

## Scheduling engine (Phase 2 — SRS §2, §9, V2 §G/§H/§L)

`lib/scheduling/` is the single source of truth for "can this restaurant
accept an order for this pickup time," used identically during scheduling
(Phase 2) and, going forward, at checkout/payment time (Phase 3):

- **`timezone.ts`** — every wall-clock comparison in the app (restaurant
  hours, slot bucketing, "today" for exceptions) goes through this file.
  It hand-rolls `+05:30` (IST) offset arithmetic rather than calling an
  installed timezone library, because this environment had no network
  access to verify one's exact runtime behavior — see the file's own doc
  comment and `docs/KNOWN_ISSUES.md` #9. **Do not** do ad-hoc
  `date.getUTCHours()` or `date.getHours()` calls anywhere else in the
  scheduling/ordering code path; always go through this module.
- **`hours.ts`** — resolves whether a restaurant is open at a given
  instant, checking `restaurant_hour_exceptions` (specific date) before
  `restaurant_hours` (recurring weekly).
- **`capacity.ts`** — buckets a pickup time into a fixed-width slot
  (`restaurants.pickup_slot_interval_minutes`) and resolves that slot's
  capacity (specific-date override → recurring weekday override →
  `restaurants.default_slot_capacity`), then counts non-cancelled `orders`
  already in that bucket. **Known limitation:** this counts confirmed
  orders only — nothing "holds" a slot during scheduling before payment.
  See `docs/KNOWN_ISSUES.md` #8 — Phase 3 MUST re-check capacity again at
  the moment an order is actually created after payment.
- **`feasibility.ts`** — `checkPickupFeasibility(restaurantId, pickupTime)`
  is the ONE function that combines hours + capacity + preparation cutoff
  + pause state into a single yes/no + reason. Both the scheduling UI and
  Phase 3's checkout revalidation call this exact function — it must never
  be reimplemented or duplicated elsewhere.
- **`walking-time.ts`** — resolves "immediately after previous pickup"
  (SRS §9) by reading the `walking_times` matrix and adding it to the
  previous stop's pickup time. Deliberately does NOT round to a slot
  boundary — the exact computed instant is what gets feasibility-checked,
  so the customer is told plainly if it doesn't work rather than having
  their pickup silently pushed later.

Every write that depends on this engine (`lib/actions/customer/schedule.ts`,
`lib/actions/customer/checkout-preview.ts`) re-derives its inputs from the
database inside the Server Action itself — a client never gets to submit a
pre-computed pickup time and have it trusted (SRS §17, V2 §L).

## Read models: which module to import

There are deliberately two grievance readers and picking the wrong one is the
easiest mistake to make in this codebase:

- **`lib/admin/grievances.ts`** (Phase 8B) — the *global* reader behind
  `/admin/grievances`. Cross-restaurant, nine saved views, ten filters, SLA
  timers, signed attachments.
- **`lib/data/admin-grievances.ts`** (Phase 6) — the *restaurant-scoped* reader
  still imported by `app/(admin)/admin/restaurants/[restaurantId]/grievances/page.tsx`.
  **Do not delete it** when tidying up; it is live.

Same rule applies generally: `lib/data/*` holds the Phase 4–6 role-scoped
readers, `lib/admin/*` holds the Phase 7–8 platform-wide ones. A page inside the
restaurant workspace wants the scoped module; a global page wants the admin one.

Client/server boundary conventions that the static verifier checks:

- A `"use server"` file may only export async functions. Type-only exports are
  fine, so a client island imports action *types* with `import type` and the
  import is erased at build time.
- `createServiceRoleSupabaseClient()` bypasses RLS. It may appear only in
  `"use server"` or `server-only` modules, only after a guard has run, and never
  in a client component. The explicit ownership check inside such an action
  (e.g. `ticket.requester_id !== profile.id`) is load-bearing, not belt-and-
  braces — RLS is not helping you on that connection.
- Modules that must never reach the browser import `server-only`.

## Snapshot principle

Beyond the financial snapshots above, two more classes of value are written once
and never recomputed: `grievance_tickets.sla_policy_snapshot` (so retuning the
SLA thresholds never retroactively makes a closed ticket look breached) and
`notifications.title`/`body` (rendered from a template at send time, so editing
the template never rewrites what a customer was already told). Corrections are
always *additive* — a new ledger row, a new timeline event, a new notification —
never an edit to the original. Every Phase 7–8 screen therefore reads history
rather than re-deriving it from current settings.

## What is not built yet

See `docs/PHASE_STATUS.md` for the per-phase record and `docs/KNOWN_ISSUES.md`
for deferred work. In short: Phase 9A (global analytics, audit viewer, fraud
review, global menus, staff & access), 9B (platform settings UI, announcements
UI, walking-time matrix, payment reconciliation), 9C (customer auth migration
from OTP to password, in-app notification centre UI, §29.2 university access
popup), and the Mandatory Handover 3 package.

**The app has never been executed in this environment.** npm returns 403 here,
so there is no `node_modules` and therefore no `tsc --noEmit`, `next build`,
`next lint` or `supabase gen types`. Verification is static, via
`node scripts/verify-static.mjs` — see `docs/TEST_REPORT.md`.
