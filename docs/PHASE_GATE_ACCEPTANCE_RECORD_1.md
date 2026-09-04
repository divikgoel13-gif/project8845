# Phase-Gate Acceptance Record — Developer 2 verifying Developer 1 (Phases 1–3)

Per SRS §47.1 (Developer 2 Gate) and §48 (Handover Acceptance Record format).
Completed before any Phase 4 work begins, per the mandatory sequence.

## Metadata

- **Previous developer / phase range reviewed:** Developer 1, Phases 1–3
  (Foundation & Access; Customer Discovery, Cart & Scheduling; Razorpay,
  Orders & QR Pickup)
- **SRS version used for audit:** UNI8 Global SRS V2.6 Master
- **Reviewing developer:** Developer 2
- **Date:** 2026-08-28

## Environment constraint — read this first

**Update 2 (same day, after tool-approval was granted):** `execute_sql`,
`get_advisors`, and `list_tables` are now working. This let me run
Supabase's own official advisor scans against the live project as a true
second, independent check on top of the source-level audit — not just
re-confirming what I already read in the SQL files.

**Live security advisor results (first pass, before this record's fixes):**
found 3 real, actionable findings and 6 expected-by-design warnings:
- Real: `set_updated_at`, `enforce_staff_limit`,
  `enforce_order_status_transition` had mutable `search_path` (inconsistent
  with `0005_rls_helper_functions.sql`'s functions, which already pin it).
  **Fixed** in `0012_security_advisor_hardening.sql`.
- Real: `handle_new_auth_user()` and `prevent_self_role_escalation()` —
  both `SECURITY DEFINER` trigger-only functions (reference `NEW`/`OLD`,
  never meant to be called directly) — were externally callable via
  PostgREST's auto-exposed RPC endpoint for `anon`/`authenticated`.
  **Fixed**: `EXECUTE` revoked from `public`/`anon`/`authenticated` in the
  same migration. Confirmed via a second advisor run that this closed
  those two findings and introduced no new ones.
- Expected, not fixed: `current_app_role`, `is_super_admin`,
  `is_active_vendor_admin_for`, `is_active_staff_for`, `my_restaurant_ids`
  are also flagged as anon/authenticated-executable `SECURITY DEFINER`
  functions. This is required for RLS to function — policies invoke these
  for the querying role, so revoking `EXECUTE` would silently break RLS
  enforcement, a worse outcome than the WARN. Left as-is, documented here
  rather than silently ignored.
- Expected, not fixed: `citext` extension installed in the `public`
  schema — standard, low-severity, disruptive to move post-hoc (would
  require touching every dependent column). Flagged for owner sign-off,
  not treated as a defect requiring immediate action.

**Live table check** (`list_tables`, the actual `pg_class` state, not
source code): **all 34/34 tables show `rls_enabled: true`** — this
independently re-confirms, on the live database itself, the same claim
already verified at the source level earlier in this record. Seed data
landed exactly as migration `0008` specifies: `admin_settings` = 4 rows,
`feature_flags` = 5 rows, `maintenance_mode` = 1 row; every other table
= 0 rows, as expected for a freshly-migrated schema with no application
traffic yet.

**Live performance advisor**: 169 findings, all optimization-class, zero
correctness or security defects — 85 `multiple_permissive_policies`
(expected consequence of Developer 1's deliberate per-verb policy split),
24 `auth_rls_initplan` (policies call `auth.uid()` directly instead of
`(select auth.uid())`, so no InitPlan caching — real but non-urgent), 46
`unindexed_foreign_keys` + 14 `unused_index` (mostly INFO-level noise on
a database with zero rows of real traffic). **Logged as non-blocking
follow-up work, not remediated in this pass** — fixing 85 policy-shape
findings is separate, substantial work that would stall this gate rather
than serve it.

**This closes the Supabase-side portion of the previously-blocking item
in full**, including the extra independent-tool check that was itself
blocked by tooling permissions earlier today. What remains open is
unchanged from Update 1: `npm install`/build and a real Razorpay
test-mode payment are still unexecuted, since this environment has
Supabase MCP access but not general network access.

## Requirements / features checked

Static, source-level re-verification (not re-running Developer 1's scripts —
independently reproducing their checks against the raw files):

| Claim (from Developer 1's docs) | Method | Result |
|---|---|---|
| 34/34 tables have `ENABLE ROW LEVEL SECURITY` | Diffed every `CREATE TABLE` against every `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` across `supabase/migrations/` | ✅ Confirmed, 34/34 |
| 34/34 tables have `FORCE ROW LEVEL SECURITY` | Same method | ✅ Confirmed, 34/34 |
| `orders` has no client-writable UPDATE/DELETE policy | Grepped `0006_rls_policies.sql` for all policies touching `orders` | ✅ Confirmed — only `orders_select_scoped` and `orders_insert_owner` exist |
| Commission rate never hardcoded outside the seed migration (SRS §23, §11.5) | Grepped all `.ts`/`.tsx` for `0.08` / `commission_rate` literals | ❌ **Violation found** — see Defects below |
| All `@/`-aliased imports resolve to real files | Script-checked all 152 occurrences against the filesystem | ✅ Confirmed, 0 missing |
| QR fallback design deviates from SRS V2 §K's literal "signed token" wording | Compared `docs/PAYMENTS.md`'s QR fallback section against SRS V2 §K | ⚠️ Confirmed deviation — but documented with reasoning per §39's requirement; substance (authenticated, restaurant-scoped, logged) is preserved |
| README reflects current phase status | Compared `README.md` "Current status" line against `docs/PHASE_STATUS.md` | ❌ Stale — see Defects below |

## Defects / non-compliance discovered

1. **Hardcoded commission-rate fallback in `lib/actions/customer/checkout.ts`**
   (line 102, pre-fix). `commissionRate` silently fell back to a literal
   `0.08` if `admin_settings.commission_rate` was missing or malformed —
   the exact pattern `docs/HANDOVER_1.md` itself calls out as a hard rule
   violation ("If you find yourself writing `0.08` in application code
   outside of `0008_seed_platform_settings.sql`'s seed value, stop").
   This sits at the point where real money is split between UNI8 and the
   vendor on every order — the highest-stakes place this could have
   occurred.

2. **`README.md` "Current status" line is stale** — still reads "Phase 1
   — Foundation, Architecture & Access, in progress" despite Phases 1–3
   being complete per `docs/PHASE_STATUS.md`. Cosmetic, but the README is
   a new developer's first read.

No other defects surfaced in this pass. Everything else independently
checked matched Developer 1's own claims exactly, including the honestly-
disclosed gaps (nothing in Phases 1–3 has been executed against a live
environment).

## Corrective work completed

1. **Fixed #1** — `checkout.ts` now fails the checkout loudly
   (`{ ok: false, issues: [...] }`, the same shape used elsewhere in this
   function) if `admin_settings.commission_rate` can't be read as a
   number, instead of silently computing every order's financial split
   against a magic number that could diverge from the real setting.
   No hardcoded numeric fallback remains anywhere in application code.
2. **#2 (README staleness) — not yet fixed**, flagged as a remaining issue
   below rather than corrected in this pass (low severity, doesn't affect
   correctness).
3. **Applied `0012_security_advisor_hardening.sql`** — pinned
   `search_path` on 3 trigger functions and revoked public `EXECUTE` on 2
   `SECURITY DEFINER` trigger-only functions, per live Supabase security
   advisor findings (see environment-constraint note above for full
   detail and the reasoning for what was deliberately left unfixed).
   Verified via a second advisor run that this closed exactly those
   findings and introduced none.

## Remaining issues, with explicit classification

- **[BLOCKING — cannot be closed without live app execution] The Next.js
  application itself has never been run.** No `npm install`, `typecheck`,
  `build`, or real Razorpay test-mode payment. The Supabase half of this
  item (schema, RLS, triggers, functions, seed data — all now live and
  independently re-verified via two rounds of Supabase's own advisor
  tool) is closed as of this update. What remains requires either general
  network access in this environment or someone running the app locally
  against the now-live `uni8` Supabase project and working through
  `docs/TEST_REPORT.md`'s manual test plan for real.
- **[NEW — non-blocking, logged for follow-up] 169 live performance
  advisor findings** (85 multiple-permissive-policy, 24 auth.uid()
  InitPlan, 46 unindexed FK, 14 unused-index) — all optimization-class,
  zero correctness/security impact, not remediated in this pass. Worth a
  dedicated pass once real traffic patterns exist (unused-index findings
  are meaningless on a zero-row database).
- **[NEW — expected by design, not a defect] 6 SECURITY DEFINER /
  extension-in-public advisor warnings intentionally left unfixed** — see
  the environment-constraint note above for why fixing them would do more
  harm (breaking RLS) or cost (touching every citext column) than the
  WARN itself justifies.
- **[MINOR — cosmetic, non-blocking] README status line is stale.**
  Should be updated to reflect Phases 1–3 complete before Phase 4 work
  is merged.
- **[DISCLOSED DEVIATION — needs owner sign-off, not a code defect] QR
  fallback** uses phone-search + staff confirmation instead of a signed,
  short-lived token as SRS V2 §K's literal wording describes. Reasoning
  is documented in `docs/PAYMENTS.md`. Functionally equivalent on the
  security properties that matter (authenticated, restaurant-scoped,
  fully audit-logged), but it is a deviation from the spec's literal
  mechanism and should get an explicit yes/no from the UNI8 owner before
  Phase 4 builds anything on top of it.
- **Known Issues #2, #3, #6, #7, #10, #11, #16, #17** (from
  `docs/KNOWN_ISSUES.md`) — all correctly scoped by Developer 1 as future-
  phase work (Phase 4/5/7/8/9/10), not Phase 1–3 non-compliance. Not
  re-litigated here; carried forward as-is.

## Confirmation

Phases 1–3 **now satisfy their SRS completion criteria at both the
source-code level and, as of this update, the live-database level**:
schema, RLS (34/34 tables, live-confirmed), auth layering, scheduling
logic, payment/idempotency design, QR flow, seed data, and two rounds of
independent security-advisor verification, with two real defects found
and fixed (one source-level: hardcoded commission fallback; two
live-database-level: mutable search_path, public-executable trigger
functions). They do **not yet** satisfy the "project can be run by a new
developer using only the documented setup" standard from
`docs/PHASE_STATUS.md`'s Phase 1 completion table — the Next.js
application itself has still never been executed. That item remains
explicitly open, narrowed from "no live environment at all" to
specifically "the app has never run," pending either network access or
someone running it locally against the now-live project.

**Gate status: passed for the database/schema layer; conditionally
passed overall.** Phase 4 work may begin — the foundation it builds on
is now genuinely verified live, not just on paper. The app-execution gap
above is still owed and should happen in parallel with, not after,
Phase 4 work.

---

## Phase 4 (Vendor Admin Operations) — build summary

Built against §10 of the SRS (Vendor Admin Dashboard Requirements) and
the Phase 4 deliverable list, excluding Payments and Grievances (both
explicitly Phase 6 scope, not Phase 4).

**Delivered:** Vendor Dashboard (GMV, orders, AOV, upcoming pickups,
collected/pending, sales trend, pickup demand, top products, alerts);
Orders page (search/filter/date/status); Analytics page (GMV trend,
orders trend, AOV, orders-by-pickup-hour, top products, collected vs.
cancelled/no-show, repeat-customer share); Products page (add/edit/
archive/restore, categories, availability toggle, optional image upload,
optional quantity-based inventory); Manage Staff (create/deactivate/
reactivate, secure credential reset, real force-logout, activity feed
from the audit log); Vendor Admin profile page with self-service password
change. Scan Orders already existed from Phase 3 and needed no changes
beyond a container-markup fix (see below).

**Judgment calls made and documented in code, not silently decided:**
- **Staff-creation scope**: §6 lists staff creation under Super Admin
  capabilities; §10 (the actual Phase 4 source) lists "Manage Staff" as a
  Vendor Admin dashboard page. Resolved as dual-control — Vendor Admin
  manages their own restaurant's staff directly; Super Admin's
  platform-wide override is separate, later, Phase 7/8 work. Documented
  at the top of `lib/actions/vendor/staff.ts`.
- **GMV/trend definitions**: no `paid_at` column exists, so trends use
  `created_at` as a pragmatic stand-in; GMV excludes cancelled/refunded/
  no-show orders by design. Documented at the top of
  `lib/data/vendor-analytics.ts`.

**Real defects found and fixed during the build itself** (not just
during the earlier Phase 1–3 audit):
1. **Broken force-logout.** `supabase.auth.admin.signOut(userId, scope)`
   takes a session JWT, not a user id — there is no per-user "kill all
   sessions" call in the Admin API. Verified this against Supabase's own
   docs before trusting it, since a silently-broken force-logout would
   be a real security gap masquerading as a fix. Corrected by adding a
   `SECURITY DEFINER` Postgres function (`force_logout_user`, migration
   `0014`) that deletes the target user's `auth.refresh_tokens` rows —
   the same mechanism Supabase's own `signOut()` uses internally — with
   `EXECUTE` revoked from `anon`/`authenticated` (only the service-role
   client can call it). Tested directly against the live database with a
   harmless non-existent user id, and confirmed the revoke actually took
   effect via `information_schema.role_routine_grants`, before wiring it
   into `staff.ts`.
2. **Ambiguous PostgREST embed.** `orders` has two foreign keys to
   `profiles` (`customer_id` and `cancelled_by`), so `vendor-orders.ts`'s
   original `profiles(name, phone)` embed would have failed at request
   time. Fixed by naming the constraint explicitly
   (`profiles!orders_customer_id_fkey(...)`). Then checked the entire
   codebase — old Phase 1–3 code included — for the same class of bug by
   diffing every table's foreign keys against every embed actually used;
   confirmed this was the only occurrence anywhere.
3. **Nested `<main>` elements.** Introducing a shared vendor layout with
   its own `<main>` would have nested a second `<main>` inside it on the
   pre-existing Scan page, which had its own. Fixed by converting Scan's
   wrapper to a plain `<div>` now that the layout provides the single
   `<main>` for the route group.

**New live infrastructure created this phase** (beyond migrations):
- `product-images` Supabase Storage bucket + RLS (migration `0013`) —
  existed only as a name reference in `lib/storage/buckets.ts` since
  Phase 1; now actually created and access-controlled (public read,
  vendor-admin-only write scoped to their own restaurant's path prefix).
- `types/database.ts` regenerated a second time (now reflects migrations
  through `0014`, including `force_logout_user` in `Functions`).

**Verification performed on the new code**, mirroring the rigor applied
to the Phase 1–3 audit rather than taking my own output on faith: every
`@/`-aliased import checked to resolve to a real export (not just a real
file); brace/paren/bracket balance checked across every new/changed
file; the FK-ambiguity check described above; the force-logout function
tested directly against the live database, not just assumed to work
from the migration applying cleanly.

**Not done in this phase** (carried forward, same reasoning as the
Phase 1–3 gate): the app has still never been executed
(`npm install`/build/dev server) — everything above is verified by
static analysis, live-database checks via the Supabase MCP connection,
and direct SQL/RPC testing, but not by actually running Next.js. This is
the same blocking item from the Phase 1–3 record, unchanged in kind,
just now also covering Phase 4's code.

---

## Phase 5 (Staff Portal & Restaurant Operations) — build summary

Built against SRS §Phase 5 (Staff Portal & Restaurant Operations) and its
completion standard: "Staff has only Orders + Scan permissions"; "Staff
cannot access vendor finances or customer information beyond what is
operationally required"; "Capacity/cutoff rules prevent invalid customer
promises"; "No-show and late pickup states are recorded correctly."

**The key discovery driving this phase's scope**: Phase 2/3 already built
a complete, correct ENGINE for hours/capacity/cutoff enforcement
(`lib/scheduling/{feasibility,capacity,hours}.ts`) and a well-designed
`transitionOrder()` state-machine helper — but nothing in the codebase
ever actually called `transitionOrder` past `"scheduled"`.
`finalizePayment()` auto-advances `payment_pending → paid → scheduled`,
and the scan flow handles `ready_for_pickup → collected`, but
`preparing` and manually-set `ready_for_pickup` were unreachable in
practice — there was no code path that ever put an order into them. This
phase's real content is filling that gap, not rebuilding the engine.

**Delivered:**
- `lib/actions/restaurant/order-status.ts` — `startPreparing`,
  `markReady`, `markNoShow`, `cancelOrderByRestaurant` (the last one
  vendor-admin-only, since it carries a real financial penalty per SRS
  V2 §C.2; the rest available to both vendor_admin and staff via
  `requireRestaurantScope`'s default `allowedRoles`). This is what makes
  the kitchen pipeline actually operable for the first time.
- Real Staff Orders page (upcoming visibility, pickup time visibility,
  operational statuses, action buttons, an overdue-pickup alert) and a
  new minimal Staff layout (exactly two links: Orders, Scan — nothing
  else reachable, matching §11 structurally, not just by convention).
  Financial data (order subtotal) is deliberately withheld from staff's
  view — see the doc comment in `components/restaurant/order-queue.tsx`
  for the reasoning on where that data-minimization line was drawn.
- Vendor Admin Orders page upgraded with the same action buttons (vendor
  admin can also run the kitchen pipeline, not just staff), plus
  cancellation.
- Vendor Admin Settings page + `lib/actions/vendor/restaurant-settings.ts`
  — pause/unpause, preparation cutoff, grace period, pickup slot
  interval/default capacity, weekly hours, date-specific exceptions,
  per-slot capacity overrides. Every one of these writes exactly the
  columns/tables the Phase 2/3 engine already reads, closing the
  "engine exists, nothing can configure it" gap.

**No new migrations this phase** — every table/column Phase 5 needed
(`restaurant_hours`, `restaurant_hour_exceptions`, `pickup_capacity_
overrides`, `restaurants.preparation_default_minutes`/`grace_period_
minutes`/`pickup_slot_interval_minutes`/`default_slot_capacity`/
`paused_until`/`paused_reason`, `restaurant_cancellation_events`,
`orders.cancel_penalty_rate`/`cancel_penalty_amount_paise`) already
existed from Phase 1. Confirms those Phase 1 migrations were built with
real foresight for work that hadn't started yet.

**Real defect avoided, not just fixed**: before writing the restaurant-
cancellation penalty logic, re-applied the same "no hardcoded fallback"
rule from the original commission-rate fix — `cancelOrderByRestaurant`
fails loudly if `admin_settings.restaurant_cancellation_penalty_rate`
can't be read as a number, rather than silently computing a real
financial penalty against a magic default.

**Verification performed**: the same import/export-resolution and
bracket-balance checks as Phase 4, re-run across every new/changed file;
confirmed no new ambiguous PostgREST embeds were introduced (all new
queries in this phase are plain column selects, no `table(...)` joins);
re-confirmed `requireRestaurantScope`'s default `allowedRoles` really is
`["vendor_admin", "staff"]` by re-reading `lib/auth/guards.ts` directly
rather than relying on memory of it from Phase 4's read.

**Not done in this phase**: same standing item as Phases 1–4 — the app
has still never actually been executed. Also explicitly NOT built: an
automated (cron/scheduler-triggered) no-show transition once a grace
period elapses — `markNoShow` is a manual action a staff/vendor admin
must trigger, because no scheduler exists in this deployment to run one
automatically. Documented in `order-status.ts` rather than silently
left unbuilt or fabricated as if it worked.

---

## Phase 6 (Payments, Manual Disbursement & Vendor Grievances) — build summary

Built against SRS §19 "PHASE 6" deliverables, §V's V2 additions (manual
refund support; "refunds are always manual, via a grievance"), and §13
(central grievance CRM). This is the first phase where real money leaves
the platform, so the design bias throughout is *additive ledgers +
audited mutations + reconciliation-by-construction*, never
recompute-on-read.

**Delivered:**
- **Vendor financial read-side** (`lib/data/vendor-payments.ts`):
  outstanding-payable summary, per-order breakdown, disbursement history,
  and vendor proof viewing. Every figure is read from the
  `vendor_payables` ledger (one row per paid order, `amount_paise`
  snapshotted at checkout as subtotal − commission using the rate in
  force at that time), never recomputed as gross×(1−rate). This is what
  makes the completion standard "vendor payable reconciles with paid
  orders and commission logic" hold *by construction*: a later
  commission-rate change cannot retroactively move a single number.
- **Vendor Payments page** + **payout acknowledgement**
  (`app/(vendor)/vendor/payments/page.tsx`,
  `lib/actions/vendor/acknowledge-payout.ts`): summary cards, per-order
  table, disbursement history with short-lived signed proof links, and
  Received / Not-received actions. "Not received" transitions the
  disbursement to `acknowledged_not_received` AND opens a linked payment
  grievance (`requester_role='vendor'`, priority high), so a disputed
  payout can never silently disappear.
- **Super Admin payout queue + manual disbursement**
  (`app/(admin)/admin/payments/*`, `lib/actions/admin/disburse.ts`):
  per-restaurant outstanding aggregation (oldest-unpaid-first), and a
  disbursement workspace that uploads proof to the private bucket
  *before* mutating the ledger, allocates the amount oldest-first with a
  per-payable optimistic-concurrency update
  (`.eq("disbursed_amount_paise", <observed>)`), and records the
  per-payable allocation in `disbursements.covers`.
- **Central grievance CRM** (`lib/data/{vendor,admin}-grievances.ts`,
  `lib/actions/{vendor,admin}/grievance.ts`, vendor + admin pages):
  create/reply/internal-note/status-workflow. Vendor tickets reach
  Super Admin only; internal notes are hidden from the requester by RLS,
  not just by the UI.
- **Manual refund recording** (`lib/actions/admin/refund.ts`): writes an
  audited `refund_events` ledger row against the originating grievance
  and posts an internal note — deliberately additive, never overwriting
  the original sale/commission (mirrors `restaurant_cancellation_events`).

**Judgment calls made and documented in code, not silently decided:**
- **No automated Razorpay refund path.** V1/V2 treat every refund as a
  real-world bank/UPI action the Super Admin performs out-of-band, then
  *records* (SRS V2 §C.3). Building an automated `razorpay.refunds`
  call would exceed the spec and introduce an un-audited money movement;
  `recordManualRefund` records the out-of-band action instead. Documented
  at the top of `refund.ts`.
- **Over-disbursement is allowed only via an explicit, reason-required,
  audited override.** The normal path guards `amount > totalOutstanding`;
  the override records the excess on the `disbursements` row without ever
  violating the per-payable `disbursed <= amount` CHECK, and logs a
  distinct `disbursement.created_override` audit action. Chosen over a
  hard block because real payouts occasionally include out-of-band
  adjustments, but never silently.
- **Proof upload precedes ledger mutation.** A failed upload must not
  leave a disbursement row pointing at a non-existent proof; ordering it
  first makes the failure mode "no disbursement recorded" rather than
  "disbursement recorded without provable proof."

**Real correctness/security considerations handled during the build:**
1. **Payout proof confidentiality.** Proofs live in a PRIVATE
   `payout-proofs` bucket (migration `0015_payout_proofs_storage.sql`);
   the vendor read-side never returns a raw storage path, only a
   300-second service-role-signed URL, and storage RLS scopes vendor
   reads by the `restaurant/<id>/` path prefix
   (`(string_to_array(name,'/'))[2]`). Confirmed the backing helpers
   (`is_super_admin`, `is_active_vendor_admin_for`) already exist from
   migrations `0005`/`0013`.
2. **Grievance confidentiality.** Re-asserted in the data layer
   (`ticket.requester_id === profile.id && requester_role === 'vendor'`)
   on top of RLS, so a vendor can never read another vendor's ticket even
   if a query were mis-scoped; internal notes filtered from the requester
   by policy.
3. **FK-disambiguated PostgREST embeds.** `grievance_tickets` and
   `grievance_messages` both have multiple FKs to `profiles`, so all
   name embeds name the constraint explicitly
   (`profiles!grievance_messages_sender_id_fkey(name)`) — the same class
   of bug fixed in Phase 4, checked again here.

**New infrastructure created this phase:**
- `payout-proofs` private Supabase Storage bucket + RLS
  (migration `0015_payout_proofs_storage.sql`) — like `product-images`
  in Phase 4, it existed only as a name reference in
  `lib/storage/buckets.ts`; the migration now creates it and scopes
  access. Must be applied to the live project.
- Super Admin Command Center shell (`app/(admin)/admin/layout.tsx`)
  providing the single `<main>` for the route group, with real links to
  Dashboard, Payments, and Grievances (the pages built so far); the
  pre-existing dashboard page was converted to plain content to avoid a
  nested `<main>`, the same fix applied to Scan in Phase 4.

**Verification performed** (same rigor as prior phases, not taking my own
output on faith): every `@/`-aliased import in the new/changed files
checked to resolve to a real export; every DB column/enum referenced
(disbursement/grievance statuses, `refund_events` columns) checked against
`types/database.ts`; FK-ambiguity check on the new grievance embeds;
middleware prefix matching confirmed to cover the new `/vendor/payments`,
`/vendor/grievances`, `/admin/payments`, `/admin/grievances` subroutes.

**Not done in this phase — the standing, still-blocking item:** the app
has still never been executed. In this environment
`npm install` fails with `E403 Forbidden` from the npm registry and
`npx --offline tsc` fails with `ENOTCACHED` — there is no network access
to the registry and no cached toolchain — so a real `next build` /
`tsc --noEmit` / `next lint` cannot be run here. Phase 6 is therefore
verified by static analysis and the schema checks above, exactly as
Phases 1–5 were, and this remains the same blocking item from the Phase
1–3 gate: it must be closed by running the app in an environment with npm
access (and, for the money paths, a real Razorpay/bank test run) before
final sign-off. No new feature scope beyond Phase 6 was started.
