# Phase 1 Status — Foundation, Architecture & Access

Tracked against SRS §19 "PHASE 1 — Foundation, Architecture & Access"
deliverables and completion standard.

## Deliverables

| Deliverable | Status | Notes |
|---|---|---|
| Next.js App Router + TypeScript application foundation | ✅ Done | `package.json`, `tsconfig.json`, `next.config.js` |
| Supabase project integration | ⚠️ Scaffolded, unverified | Clients written (`lib/supabase/*`); no live project connected in this environment to confirm connectivity |
| Core database schema and migrations | ✅ Done | `supabase/migrations/0001`–`0009`, covers users/roles/restaurants/products plus the full downstream operational schema (orders, payments, payables, disbursements, grievances, audit, settings) so Phases 2–9 aren't blocked on schema work |
| Customer phone OTP authentication and onboarding | ✅ Done | `app/auth/customer/`, collects name/email/course only (no block/hostel, per §1.1) |
| Vendor Admin, Staff and Super Admin authentication foundations | ✅ Done | Shared email+password form, role-checked post-login |
| RBAC and restaurant-scoped authorization model | ✅ Done | `lib/auth/roles.ts`, `lib/auth/guards.ts` |
| RLS foundations for all relevant tables | ✅ Done | Every table in `supabase/migrations/000{2,3,4}_*` has RLS enabled + forced in `0006_rls_policies.sql` |
| Shared UI/design system and route structure for all four experiences | ⚠️ Partial | Brand tokens + Button/Card primitives done; route stubs exist for all four roles; full component library is a Phase 2 (§26.3) deliverable, not Phase 1 |
| Storage structure for product images, grievance attachments and payout proofs | ⚠️ Partial | Bucket registry + path-builder written (`lib/storage/buckets.ts`); actual bucket creation + Storage RLS policies not yet applied to a live project (documented commands in `docs/ARCHITECTURE.md`) |
| Environment/secrets structure and dev/staging conventions | ✅ Done | `.env.example`, `.gitignore` |
| Base audit-log framework | ✅ Done | `audit_logs` table + `lib/audit/log.ts`, demonstrated end-to-end in `lib/actions/admin/update-commission-rate.ts` |

## Phase completion standard

| Standard | Status |
|---|---|
| All four role experiences have authenticated route foundations | ✅ `app/(customer)`, `(vendor)`, `(staff)`, `(admin)` all exist with working guards |
| Roles cannot access unauthorized areas | ✅ Enforced at middleware + guard + RLS layers (see `docs/AUTH_RBAC.md`); **not yet verified against a running instance** — see Known Issues |
| Database migrations are reproducible | ✅ Numbered, ordered SQL files, no manual dashboard-only steps required except bucket creation (documented) |
| RLS/authorization foundation exists before feature expansion | ✅ |
| Project can be run by a new developer using only the documented setup | ⚠️ **Unverified** — see Known Issues, item 1 |

## What Phase 1 deliberately does NOT include

Per SRS phase boundaries — these are correctly out of scope here, not gaps:

- Customer discovery/search/menu browsing UI (Phase 2)
- Cart, multi-restaurant scheduling, walking-time logic (Phase 2)
- Razorpay checkout, order creation, QR generation/scanning (Phase 3)
- Any vendor/staff/admin page content beyond a guarded placeholder
  (Phases 4–9)
- Production web fonts / full component design system / motion (Phase 2,
  SRS §26.3)
- SMS provider selection and integration (SRS V2 §E — Phase 3 per §V)

See the numbered phase list in the SRS for the authoritative scope of each
later phase.

---

# Phase 2 Status — Customer Discovery, Cart & Scheduling

Tracked against SRS §19 "PHASE 2 — Customer Discovery, Cart & Scheduling"
deliverables and completion standard.

## Deliverables

| Deliverable | Status | Notes |
|---|---|---|
| Customer home/explore experience | ⚠️ Placeholder | `app/page.tsx` links to `/restaurants`; a real discovery/hero experience matching SRS §26 brand direction is still open (visual design pass, not logic) |
| Restaurant listing and search | ✅ Done | `app/(customer)/restaurants/page.tsx`, `lib/data/restaurants.ts` — simple `?q=` search |
| Restaurant menu/product pages | ✅ Done | `app/(customer)/restaurants/[slug]/page.tsx`, `lib/data/products.ts` |
| Product availability and out-of-stock handling | ✅ Done | Boolean + quantity inventory modes both resolve to a single `availability` read (SRS V2 §M) |
| Cart with multiple restaurants | ✅ Done | `lib/actions/customer/cart.ts` — server-persisted, price/availability always re-read fresh, never trusted from a stored cart value |
| Restaurant-specific cart grouping | ✅ Done | `getCurrentCartGrouped()` groups by restaurant |
| Pickup sequence selection | ✅ Done | `components/customer/schedule-form.tsx` (reorder) + `lib/actions/customer/schedule.ts` (server validation/persistence) |
| First pickup time selection | ✅ Done | Sequence step 0 is forced to `fixed_time` server-side |
| Immediate-after scheduling | ✅ Done | `lib/scheduling/walking-time.ts` |
| Walking-time matrix integration | ✅ Done | Reads `walking_times`, falls back to the reverse-direction row |
| Restaurant hours, preparation time, pickup capacity and preparation cutoff validation | ✅ Done | `lib/scheduling/hours.ts`, `capacity.ts`, `feasibility.ts` — the single `checkPickupFeasibility()` function all validation funnels through |
| Grace-period data model | ✅ Done (data model only) | `restaurants.grace_period_minutes` (Phase 1); no-show/grace *behavior* is Phase 3/5 |
| Checkout summary and order preview | ✅ Done | `app/(customer)/checkout/page.tsx`, `lib/actions/customer/checkout-preview.ts` — this is a PREVIEW; actual order/payment is Phase 3 |

## V2 additions folded into Phase 2 (per SRS V2 §V)

| Addition | Status | Notes |
|---|---|---|
| Restaurant pause state | ✅ Done | Checked in `checkPickupFeasibility` and `isRestaurantOrderable`; `paused_reason` surfaced on the menu page |
| Stale-cart revalidation | ✅ Done | `getCheckoutPreview()` re-checks price/availability/hours/capacity/pause fresh on every render, never trusts the scheduling-time snapshot |
| Pickup countdown model | ✅ Done | `components/customer/pickup-countdown.tsx` — server-computed instant, client only ticks a display, per SRS V2 §H |
| Multi-restaurant order-group UX | ✅ Done | Sequence reordering UI + grouped checkout summary |
| Unified QR model | ⚠️ Schema only | `multi_order_groups.qr_token` exists (Phase 1 schema); actual QR rendering/scanning is Phase 3 |

## Phase completion standard

| Standard | Status |
|---|---|
| Customer can discover restaurants and products | ✅ |
| Customer can create a valid single- or multi-restaurant cart | ✅ |
| Pickup times are calculated correctly | ✅ — server-computed via `buildCampusInstant`/walking-time resolution, campus-timezone-aware (see `lib/scheduling/timezone.ts`) |
| Invalid/over-capacity/closed slots are prevented | ✅ — `checkPickupFeasibility()` is the single authoritative gate, called both at scheduling and again at checkout preview |
| Multi-restaurant sequence is persisted correctly | ✅ — `multi_order_groups` + `pickup_sequences` rows written only after every step passes feasibility |

## Known gaps — see `docs/KNOWN_ISSUES.md` for full detail

- Capacity checking has a genuine TOCTOU race under concurrent load (slots aren't "held" during scheduling) — flagged as a Phase 3 checkout-time re-check requirement, not silently ignored.
- Timezone conversion uses hand-rolled fixed-offset (+05:30) arithmetic instead of a verified IANA timezone library call, because this environment couldn't `npm install`/test one. Correct for India, but a known simplification.
- No orphan-cleanup job yet for abandoned draft `multi_order_groups` (created every time a customer confirms/reconfirms a schedule without ever paying).
- Discovery home page is functionally complete but visually minimal — the full §26 brand-driven design pass is still open.

---

# Phase 3 Status — Razorpay, Orders & QR Pickup

Tracked against SRS §19 "PHASE 3 — Razorpay, Orders & QR Pickup"
deliverables and completion standard. **This phase completes Mandatory
Handover 1** — see `docs/HANDOVER_1.md` for the full handover package
index.

## Deliverables

| Deliverable | Status | Notes |
|---|---|---|
| Razorpay customer checkout integration | ✅ Done, unverified | `lib/payments/razorpay.ts`, `components/customer/razorpay-checkout-button.tsx` — see `docs/PAYMENTS.md` for the "unverified" caveat |
| Server-side trusted order total calculation | ✅ Done | Computed inside `initiateRazorpayCheckout` from a freshly re-validated `getCheckoutPreview`, never from client input |
| Payment verification and webhook handling | ✅ Done, unverified | `app/api/webhooks/razorpay/route.ts` + `lib/orders/finalize-payment.ts` |
| Idempotent payment event processing | ✅ Done | Three independent idempotency layers — see `docs/PAYMENTS.md` |
| Order creation and order state machine | ✅ Done | `lib/orders/state-machine.ts` (TS) + `0011_order_state_machine_trigger.sql` (DB-level mirror, defense in depth) |
| Customer order history and order detail | ✅ Done | `app/(customer)/orders/`, `lib/data/orders.ts` |
| Unique QR/pickup token generation | ✅ Done | `multi_order_groups.qr_token` (Phase 1 schema), one QR per checkout group per SRS V2 §J |
| Vendor/Staff scanning and atomic collection | ✅ Done, unverified | `lib/orders/scan.ts`, `components/restaurant/scan-form.tsx` — manual/hardware-scanner text entry, not camera-based decode; see the component's own doc comment for why |
| QR invalidation after collection | ✅ Done | Enforced by the state machine — `collected` is terminal, a second scan of the same order fails via optimistic concurrency |
| Payment/order exception handling | ✅ Done | See `docs/PAYMENTS.md`'s exception table |
| Customer rating flow for eligible completed orders | ✅ Done | `lib/actions/customer/rating.ts` — enforced by RLS, not just application logic |

## V2 additions folded into Phase 3 (per SRS V2 §V)

| Addition | Status | Notes |
|---|---|---|
| SMS abstraction / OTP / transactional SMS foundation | ✅ Interface + console provider only | `lib/notifications/sms/` — no real India SMS provider selected yet (that's a documented pre-production decision per SRS §Y, not a foundation task); wired to fire on `order_paid` as a demonstration |
| Unified QR authorization | ✅ Done | `lib/orders/scan.ts#resolveOrderForRestaurant` — one QR resolves to a different order per restaurant, never exposes another restaurant's data (SRS V2 §J) |
| QR fallback verification | ✅ Done, different design than literal spec wording | Phone-search + staff confirmation instead of a signed token — see `docs/PAYMENTS.md` "QR fallback" for the reasoning |

## Phase completion standard

| Standard | Status |
|---|---|
| Successful payment creates correct paid order(s) | ✅ — traced by hand, not yet run against a real payment |
| Failed/duplicate payment events do not create duplicate orders | ✅ — three-layer idempotency, see `docs/PAYMENTS.md` |
| Each restaurant order receives its own valid QR | ✅ — via the shared group QR + restaurant-scoped resolution (SRS V2 §J's unified-QR model, not one QR image per restaurant) |
| Only authorized restaurant staff/vendor can collect | ✅ — `requireRestaurantScope` + restaurant_id filter in `resolveOrderForRestaurant`, both independently checked |
| Double scanning cannot double-collect | ✅ — optimistic-concurrency transition, traced by hand for the race case |
| Customer can see completed/upcoming orders and rate eligible orders | ✅ |

## Known gaps — see `docs/KNOWN_ISSUES.md` for full Phase 3 detail

- **Nothing in this phase has been executed** — no real Razorpay payment, no real webhook delivery, no `npm install`. This is the dominant caveat over everything else; see `docs/TEST_REPORT.md`.
- Camera-based QR scanning isn't implemented — text-entry only (functionally complete, see reasoning in `components/restaurant/scan-form.tsx`).
- `orders.scan_token` (defined in the Phase 1 schema) ended up unused by the actual implementation, which resolves scans via the group's `qr_token` instead.
- No Super Admin exception-review UI yet for the audit-logged payment/order exceptions — that's Phase 7.

---

# Phase 4 Status — Vendor Admin Operations

Tracked against SRS §10 (Vendor Admin Dashboard Requirements). Full build
narrative, judgment calls, and defects-found-during-build are in
`docs/PHASE_GATE_ACCEPTANCE_RECORD_1.md` ("Phase 4 … build summary").

## Deliverables

| Deliverable | Status | Notes |
|---|---|---|
| Vendor Dashboard | ✅ Done | GMV, orders, AOV, upcoming pickups, collected/pending, sales trend, pickup demand, top products, alerts |
| Orders page | ✅ Done | Search / filter / date / status; FK-disambiguated customer embed |
| Analytics page | ✅ Done | GMV & orders trend, AOV, orders-by-pickup-hour, top products, collected vs. cancelled/no-show, repeat-customer share (`lib/data/vendor-analytics.ts`) |
| Products page | ✅ Done | Add/edit/archive/restore, categories, availability toggle, optional image upload, optional quantity inventory |
| Manage Staff | ✅ Done | Create/deactivate/reactivate, secure credential reset, real force-logout, audit-log activity feed |
| Vendor Admin profile | ✅ Done | Self-service password change |
| Scan Orders | ✅ Done (Phase 3) | Unchanged except a container-markup fix (nested `<main>`) |

## Phase completion standard

| Standard | Status |
|---|---|
| Vendor Admin can run their restaurant's day-to-day operations | ✅ |
| Financial/commission figures derive from snapshots, never recomputed | ✅ — Payments proper is Phase 6, but analytics already read snapshotted values |
| No hardcoded rate fallbacks | ✅ — trends use `created_at` (no `paid_at` column) with the choice documented, no magic rates |

## Known gaps

- **Payments and Grievances are deliberately NOT Phase 4** — both are Phase 6 scope and were built there.
- Force-logout required a `SECURITY DEFINER` Postgres function (`force_logout_user`, migration `0014`) because Supabase's Admin API has no per-user "kill all sessions" call — see the acceptance record for the full reasoning.
- Same standing caveat: the app has never been executed.

---

# Phase 5 Status — Staff Portal & Restaurant Operations

Tracked against SRS Phase 5 (Staff Portal & Restaurant Operations). Full
build narrative in `docs/PHASE_GATE_ACCEPTANCE_RECORD_1.md` ("Phase 5 …
build summary").

## Deliverables

| Deliverable | Status | Notes |
|---|---|---|
| Kitchen pipeline actions | ✅ Done | `startPreparing`, `markReady`, `markNoShow`, `cancelOrderByRestaurant` (`lib/actions/restaurant/order-status.ts`) — makes `preparing`/`ready_for_pickup` reachable for the first time |
| Staff Orders page | ✅ Done | Upcoming/pickup visibility, operational statuses, action buttons, overdue-pickup alert |
| Staff layout | ✅ Done | Exactly two links (Orders, Scan) — nothing else reachable |
| Staff data minimization | ✅ Done | Order financial data withheld from staff view (`components/restaurant/order-queue.tsx`) |
| Vendor Admin Orders upgrade | ✅ Done | Same action buttons + restaurant-initiated cancellation |
| Vendor Admin Settings | ✅ Done | Pause/unpause, prep cutoff, grace period, slot interval/default capacity, weekly hours, date exceptions, per-slot overrides (`lib/actions/vendor/restaurant-settings.ts`) |

## Phase completion standard

| Standard | Status |
|---|---|
| Staff has only Orders + Scan permissions | ✅ |
| Staff cannot access vendor finances / excess customer info | ✅ — enforced by RLS + view-level omission |
| Capacity/cutoff rules prevent invalid promises | ✅ — Phase 2/3 engine now actually configurable via Settings |
| No-show and late pickup states recorded correctly | ✅ — `markNoShow` (manual; no scheduler exists to auto-fire it, documented) |

## Known gaps

- No automated grace-period no-show transition — `markNoShow` is manual because no scheduler exists in this deployment (documented, not silently omitted).
- No new migrations needed — every table/column already existed from Phase 1.
- Same standing caveat: the app has never been executed.

---

# Phase 6 Status — Payments, Manual Disbursement & Vendor Grievances

Tracked against SRS §19 "PHASE 6" deliverables + §V (V2 additions: manual
refund support, refunds always via a grievance) and §13 (central grievance
CRM). Full build narrative in
`docs/PHASE_GATE_ACCEPTANCE_RECORD_1.md` ("Phase 6 … build summary").

## Deliverables

| Deliverable | Status | Notes |
|---|---|---|
| Vendor payable calculations | ✅ Done | Read from the `vendor_payables` ledger (one row/paid order, `amount_paise` snapshotted at checkout), never recomputed — `lib/data/vendor-payments.ts` |
| Outstanding payable view | ✅ Done | `getVendorPayableSummary` (net − disbursed = outstanding) |
| Per-order financial breakdown | ✅ Done | `listVendorPayableOrders` — gross, commission (snapshot rate), payable, disbursed, outstanding per order |
| Vendor Payments page | ✅ Done | `app/(vendor)/vendor/payments/page.tsx` — summary cards + per-order table + disbursement history |
| Vendor disbursement history | ✅ Done | `listVendorDisbursements` incl. `covers` count and status |
| Vendor proof viewing | ✅ Done | Private `payout-proofs` bucket, short-lived (300 s) service-role signed URLs — path never exposed |
| Payout acknowledgement | ✅ Done | `markPayoutReceived` / `markPayoutNotReceived` (`lib/actions/vendor/acknowledge-payout.ts`); "not received" auto-opens a linked payment grievance |
| Super Admin payout queue | ✅ Done | `listPayoutQueue` (per-restaurant outstanding, oldest-first), `app/(admin)/admin/payments/page.tsx` |
| Manual disbursement | ✅ Done | `disburseToVendor` (`lib/actions/admin/disburse.ts`) — oldest-first allocation, optimistic concurrency per payable, proof upload before ledger mutation, audited over-disburse override |
| Central grievance CRM | ✅ Done | `grievance_tickets`/`messages`/`events`; vendor + admin inboxes, threaded replies, internal notes (RLS-hidden from requester), status workflow |
| Vendor grievances | ✅ Done | `lib/actions/vendor/grievance.ts` (create/reply) + `app/(vendor)/vendor/grievances/*` |
| Super Admin grievance inbox | ✅ Done | `listAdminGrievances` (role filter) + thread + action panel; sees all tickets incl. internal notes |
| Manual refund support (V2 §C.3) | ✅ Done | `recordManualRefund` (`lib/actions/admin/refund.ts`) — writes an audited `refund_events` ledger row against the grievance; does NOT overwrite the original sale |

## Phase completion standard

| Standard | Status |
|---|---|
| Vendor payable reconciles with paid orders and commission logic | ✅ — reconciliation-by-construction: every figure reads the ledger, so a later commission-rate change cannot rewrite historical financials |
| Manual disbursement is safe against double-payment | ✅ — oldest-first allocation + per-payable optimistic-concurrency update + `disbursed <= amount` CHECK; over-disburse only via audited override |
| Payout proofs are stored securely | ✅ — private bucket, storage RLS scoped by `restaurant/<id>/` path, reads only via short-lived signed URLs |
| Vendor grievances reach UNI8/Super Admin only | ✅ — `requester_role='vendor'` + RLS; never visible to another vendor; internal notes hidden from the requester |
| Every privileged financial mutation is audited | ✅ — disbursement, refund, and status changes all call `recordAuditEvent` |
| Refunds do not overwrite the original sale | ✅ — `refund_events` is an additive ledger, mirroring `restaurant_cancellation_events` |

## Known gaps

- **No automated Razorpay refund path** — V1/V2 refunds are always a real-world bank/UPI action the Super Admin performs out-of-band, then *records* here (SRS V2 §C.3). This is by design, not a gap.
- Storage bucket + RLS for payouts is delivered as migration `0015_payout_proofs_storage.sql`; like `product-images` in Phase 4, it must be applied to the live project.
- **Same standing, still-blocking caveat: the app has never been executed** (`npm install`/`typecheck`/`build`) in this environment because the npm registry is blocked here (E403). Verification for Phase 6 was done by static analysis (column/enum names, import resolution, RLS-helper existence, middleware prefix matching) consistent with every prior phase's record. This must be run in an environment with npm access before sign-off.

---

# Phase 7 Status — Super Admin Command Center & Restaurant Workspaces

Tracked against SRS §5 (§5.1 the twelve-destination information architecture),
§6 (global dashboard, orders, restaurant creation and lifecycle), §23
(commission-rate history), §29.1 and V2.6 §60 (restaurant classification and
the four lifecycle states), plus V2 addendum §F (Live Operations Command
Center) and §O (announcements, foundation only — see "does not include").

This section was written after Phases 8A and 8B, which is why it appears out of
order in the file. The code landed first and the record is being caught up
deliberately rather than left to the Handover 3 package, because
`docs/PHASE_STATUS.md` is the file the next developer reads to find out what
exists.

## Deliverables

| Deliverable | Status | Notes |
|---|---|---|
| §5.1 sidebar, all twelve destinations live | ✅ Done | `app/(admin)/admin/layout.tsx` — the array is a transcription of the §5.1 table, three groups (COMMAND CENTER / PLATFORM / CONTROL). Phase 6 left nine of the twelve as inert labels; every entry now has a real href |
| Nothing added to the twelve | ✅ By design | §5 opens by rejecting a flat control surface, so the V2 additions live *under* the twelve: Live Ops (§F) and Announcements (§O) under Operations, reconciliation (§T) under Payments, fraud review (§S) under Audit Log, flags and maintenance (§Q/§R) under Settings |
| Global Super Admin dashboard (§6) | ✅ Done | `app/(admin)/admin/dashboard/page.tsx` — five bands in triage order: happening now, today's totals, money position, support backlog, fourteen-day shape. `revalidate = 30` so every operator sees the same numbers |
| Commission tile cannot imply causation | ✅ Done | Labelled as the *current setting*, not placed beside today's commission total as though one derived the other — §23 is explicit that changing the rate never rewrites history |
| Live Operations Command Center (§F) | ✅ Done | `app/(admin)/admin/operations/page.tsx` + `lib/admin/live-ops.ts` — all eleven §F alert classes, ordered worst-first rather than in the SRS's listing order, `revalidate = 15` |
| Alert acknowledgement is auditable, not concealing | ✅ Done | Acknowledged alerts stay listed, dimmed, with who acknowledged them. §F.1 asks for auditability, not for the problem to disappear — filtering them out would let "seen" pass for "handled" across a shift handover |
| Global cross-restaurant order search (§6) | ✅ Done | `app/(admin)/admin/orders/page.tsx` + `[id]` detail + `export/route.ts`. Every filter is a plain GET field, so the screen works without JavaScript and any filtered view is a shareable URL |
| Restaurant directory + creation (§6, §29.1) | ✅ Done | `app/(admin)/admin/restaurants/page.tsx` and `new/page.tsx`. Each row carries live product count, today's sales and money owed — the three numbers that decide whether to open a workspace |
| Four §60 lifecycle states as filter chips with counts | ✅ Done | "Which of my restaurants are closed right now" is the question the directory exists to answer at a glance, so the states are chips, not a dropdown |
| Archived restaurants excluded by default | ✅ Done | §P forbids deletion, so the archive only grows; a default view that leads with dead rows gets worse every term |
| Fourteen-page restaurant workspace | ✅ Done | `app/(admin)/admin/restaurants/[restaurantId]/` — dashboard, orders, menu, products, pickup, walking-times, staff, vendor-admins, settings, payments, disbursements, grievances, ratings, audit, over a shared `layout.tsx` |
| Workspace context resolved once | ✅ Done | `lib/admin/restaurant-context.ts` + `lib/admin/restaurant-workspace.ts`; the layout owns the restaurant lookup so fourteen pages do not each re-resolve it |
| Commission-rate changes are historical (§23) | ✅ Done | `lib/actions/admin/update-commission-rate.ts` writes a new rate and leaves every prior order's snapshot untouched |
| Restaurant lifecycle actions | ✅ Done | `lib/actions/admin/restaurants.ts` + `components/admin/restaurant-lifecycle-controls.tsx`; state changes are audited, archival replaces deletion |
| Per-restaurant staff and vendor-admin access | ✅ Done | `lib/actions/admin/restaurant-access.ts` — the Super Admin can grant and revoke within a restaurant scope without becoming a vendor |
| Platform foundations for §Q/§R | ✅ Done | `lib/platform/settings.ts`, `feature-flags.ts`, `maintenance.ts`; `assertNotInMaintenance()` is called by write actions rather than gating the admin tree, because §R requires paid orders to stay reachable and an admin-wide gate would lock the operator away from the switch that turns it off |
| Schema, RLS and indexes for Phases 7–9 | ✅ Done | Migrations `0016_phase7_9_schema.sql`, `0017_phase7_9_rls.sql`, `0019_admin_performance_indexes.sql`, plus `0020_v26_enum_additions.sql` and `0021_v26_schema.sql` for the V2.6 additions |

## Phase completion standard

| Standard | Status |
|---|---|
| The §5.1 information architecture is expressed, not approximated | ✅ Twelve destinations, three groups, nothing added beside them |
| Every admin route is unreachable without a guard | ✅ `requireRole("super_admin")` in the layout makes the route group unreachable; `requireSuperAdmin()` in every page, action and export route is the check that actually matters (§17 layered model) |
| No financial figure is recomputed from current settings | ✅ Every rupee on every Phase 7 screen comes from a per-order snapshot column; the commission rate is shown as a setting, never as a multiplier applied after the fact |
| Restaurants are archived, never deleted | ✅ §P; the directory's default filter is the only thing that hides them |
| Live Ops does not depend on Realtime | ✅ Server revalidation per §F.1, so two operators cannot read different counts and each assume the other is wrong |
| The layout fetches no page data | ✅ Each page owns its queries, so a slow aggregate cannot delay rendering the navigation |
| Every state change is audited | ✅ `recordAuditEvent()` from each action in `lib/actions/admin/` |

## What Phase 7 does not include

Correctly out of scope, not gaps:

- **The six Phase 9 routes the sidebar already links to**: `/admin/analytics`,
  `/admin/settings`, `/admin/audit` (and `/admin/audit/fraud`),
  `/admin/staff-access`, `/admin/menus`. The §5.1 nav is complete by design and
  the destinations land in 9A/9B; the static verifier's `routes` check reports
  them, which is expected and is the reason that check currently fails.
- **Announcements UI (§O)** — `lib/platform/announcements.ts` exists as the
  read/write foundation, but the operator-facing pages are Phase 9B.
- **Payment reconciliation (§T) and fraud review (§S)** — Phase 9B and 9A.
- Customer 360 (§7) and the grievance CRM (§13) — Phase 8, delivered.

## Known gaps

- `lib/admin/restaurant-workspace.ts` and several workspace pages read Supabase
  nested-join shapes through `as any`, the same pattern registered as Known
  Issue #12. It is a typing shortcut, not a correctness bug, and the fix is
  local interfaces rather than regenerated types.
- **The standing caveat holds: the app has never been executed here.** npm is
  blocked (E403), so Phase 7 was verified statically like every prior phase —
  import and named-export resolution across the `@/` aliases, every column and
  enum checked against `supabase/migrations/`, brace and JSX-tag balance, and
  `Link href` resolution. Not a substitute for a build.

---

# Phase 8 Status — Part A: Customer 360 CRM

Tracked against SRS §7 (§7.1 customer directory, §7.2 Customer 360 profile,
§7.3 operational flags) plus §8 account suspension, §14 exports, §15/§18
audit, §P retention. **This section covers Part A only** — the Phase 8B
central grievance CRM upgrade is not built yet and is deliberately excluded
(see "What Part A does not include"). Phase 7's own status table lands with
the Handover 3 package.

## Deliverables

| Deliverable | Status | Notes |
|---|---|---|
| Customer directory with search | ✅ Done | `app/(admin)/admin/customers/page.tsx` — one box searching name, email, phone, order-id prefix and ticket number |
| Segment filters (§7.1) | ✅ Done | 11 segments; thresholds are fixed in code and carried in the visible label ("High value — ₹5,000+ lifetime") so two exports taken a month apart mean the same thing |
| Activity filter + join-date range + six sorts | ✅ Done | All filter state lives in the query string, so a segment an operator is working through is a link they can send to someone else |
| Directory export (§7.1 "export capabilities", §14) | ✅ Done | `app/(admin)/admin/customers/export/route.ts` — takes the *same* query string as the page, so exporting is a link off the table rather than a second filter UI that can silently disagree with it |
| Export is audit-logged | ✅ Done | `customers.exported` records the filter set, rows exported, matched total and both truncation flags. A bulk read of names, emails, phones, spend and behavioural flags for real students is an administrative act even though nothing is written (§15/§18) |
| Customer 360 profile (§7.2) | ✅ Done | `app/(admin)/admin/customers/[customerId]/page.tsx` — identity, lifetime metrics, signals, orders, payments, refunds, support history, restaurant affinity, ratings, notes, account & security, unified timeline |
| Orders / grievances shown as indexes, not copies | ✅ Done | Both link out to `/admin/orders/[id]` and `/admin/grievances/[id]`; the CRM does not reimplement an order detail view that would drift from the real one |
| Lifetime spend from snapshots | ✅ Done | Sum of each order's own `subtotal_paise`, never recomputed from today's menu prices (§11.5/§23) |
| Six derived operational flags (§7.3) | ✅ Done | High value, repeat, open support issue, payment issue, repeated no-shows, frequent cancellations — computed on every read by `deriveCustomerFlags`, stored nowhere, each rendered with the number behind it |
| Manual admin flags, auditable | ✅ Done | `customer_flags` + `addCustomerFlag`/`clearCustomerFlag`; reason mandatory in both directions, stored on the row *and* in `audit_logs` |
| Admin notes with author/timestamp (§7.2) | ✅ Done | `customer_admin_notes` + `addCustomerNote`; `author_id` comes from the session, never from the form |
| Account suspension (§7.2, §8) | ✅ Done | `setCustomerAccountStatus` is a thin wrapper over the existing `setProfileStatus`, which already owns `profiles.status`, the self-disable refusal and the `profile.disabled`/`profile.reenabled` audit entries |
| Customer-facing invisibility | ✅ Done | Notes and flags are super-admin-only in `0017` with `force row level security` and no self-select policy — the SRS line "customers do not access the internal CRM" is enforced in the database, not only in the UI |

## Phase completion standard

| Standard | Status |
|---|---|
| Every CRM figure traces to a source table, none are stored | ✅ Aggregates and all six §7.3 badges are derived per read, so they cannot go stale and cannot be edited into existence |
| Flags are data-driven, not character judgments | ✅ Derived flags carry their evidence; a manual flag cannot be saved without a reason, and the reason renders next to the badge |
| Nothing in the CRM can be deleted | ✅ No edit or delete action exists; flags retire by dating (`cleared_at`/`cleared_by`/`clear_reason`) and cleared flags stay listed (§P) |
| Every privileged read and write is audited | ✅ Four write actions plus the export all call `recordAuditEvent` |
| Guard before service-role, at every entry point | ✅ `requireSuperAdmin()` in both pages, the export route and each action (`setCustomerAccountStatus` inherits it from `setProfileStatus`) |
| No client component touches the reader or the service-role client | ✅ `components/admin/customer-crm-controls.tsx` imports server actions and UI primitives only; the reader is `server-only` |
| The console never prints a confident wrong number | ✅ When the aggregate scan is capped the totals re-label as a floor and a warning band explains why — see Known Issues #18 |
| No new migration required | ✅ `customer_admin_notes` and `customer_flags` were created in `0016` with RLS in `0017`; Part A adds no schema |

## What Part A does not include

Correctly out of scope here, not gaps:

- **Phase 8B**: the central grievance CRM upgrade and the customer-issue
  shortcuts that hang off it, including the restyle of the pre-Phase-7
  `/admin/grievances` pages. The 360 page links *into* those routes and
  will keep working when they are rebuilt.
- Global analytics, audit viewer, platform settings, reconciliation and the
  fraud queue — Phase 9.
- Any customer-visible surface. Nothing in Part A renders outside `/admin`.

## Known gaps

- Aggregate scan cap and the two unanswerable Account & Security facts are
  registered honestly as Known Issues #18 and #19; the deliberate absence of
  delete is #20.
- **The standing caveat holds unchanged: the app has still never been
  executed here.** The npm registry remains blocked (E403), re-tested this
  phase, so `npm install`, `tsc --noEmit`, `next build` and `next lint`
  could not run. Part A was verified statically — every import and named
  export resolved across the `@/` aliases, every column and enum referenced
  checked against `supabase/migrations/`, brace and JSX-tag balance checked
  with a masking scanner validated against known-good files, and every
  `Link href` confirmed to resolve to a route file that exists. That is the
  same standard as every prior phase and it is not a substitute for a build.

---

# Phase 8 Status — Part B: Central Grievance CRM

Tracked against SRS §13 (the eighteen central-grievance-CRM capabilities),
§4/§14/§15/§18, V2 addendum §I (customer order-issue shortcuts), and V2.6 §59
("Food Not Ready Yet") and §63 (in-app notifications).

Part B replaces the Phase 6 grievance screens rather than extending them. The
Phase 6 reader `lib/data/admin-grievances.ts` is deliberately **kept**, because
the restaurant-scoped view at
`app/(admin)/admin/restaurants/[restaurantId]/grievances/page.tsx` still uses
it; the new reader `lib/admin/grievances.ts` serves the global console.

## Deliverables

| Deliverable | Status | Notes |
|---|---|---|
| Unique human ticket id | ✅ Done | `ticket_no` from a sequence; every screen and the CSV lead with it, and it is what the customer quotes |
| Twelve categories, four priorities, seven statuses | ✅ Done | All three are Postgres enums; the option tables in the page, the export route and the client islands are all typed off them so a new value cannot be half-added |
| Assignment + reassignment history (§13) | ✅ Done | `grievance_assignments` is append-only and *is* the history — reassigning inserts a row, it never overwrites `assignee_id` alone |
| SLA first-response and resolution timers | ✅ Done | `lib/grievance/sla.ts` computes due times from the policy snapshot taken at creation, so relaxing policy later cannot un-breach an old ticket and a priority change does not move an existing deadline |
| Overdue highlighting | ✅ Done | Breach is rendered on the row (`bg-danger-bg/40`) and the SLA cell distinguishes "first reply overdue" from "resolution overdue". A count that says "3 breaching" without saying which three is a worse tool than no count |
| Nine saved views | ✅ Done | Unassigned, mine, breaching, waiting on us, waiting on them, escalated, unresolved, resolved, all — each labelled by the question an agent actually asks at the start of a shift; default is *waiting on us* |
| Search + ten field filters | ✅ Done | Free text over ticket no / requester / order id, plus role, status, category, priority, assignee, restaurant, date range and five sorts — all in the query string, so a triage view is a shareable link |
| Threaded chat | ✅ Done | `grievance_messages`, rendered three ways (requester / support / internal) so an agent can see at a glance who said what |
| Admin-only internal notes | ✅ Done | `is_internal`; hidden from the requester by `grievance_messages_select_scoped` in Postgres, not by the page, and they never fire a notification |
| **Private attachments** | ✅ Done | Private bucket `grievance-attachments` (migration 0018) + `grievance_attachments` rows. Browser uploads with the user's own session so Storage RLS is the access check; the row that binds a file to the ticket is written server-side by `parseAttachmentPaths`, which rejects any path outside `ticket/<this ticket>/`. Reads are signed for 300 s at render time — nothing durable reaches the client |
| Resolution requires category + note | ✅ Done | Enforced in `setGrievanceStatus`, the single place a status can change. A resolution note that is optional in practice is not a resolution note |
| Reopen with reason, history preserved | ✅ Done | Reopen appends to `grievance_events` and bumps `reopened_count`; nothing is truncated, and both sides can do it (`reopenGrievance`, `reopenCustomerGrievance`) |
| Immutable timeline | ✅ Done | Merged from four append-only tables (`grievance_messages`, `grievance_events`, `grievance_assignments`, refunds) on time. Nothing in it derives from a mutable ticket column, so a later status change cannot rewrite it |
| Linked records (§13) | ✅ Done | Order → payment (through `orders.group_id`, since `payments` carries no `order_id`) → disbursement, plus restaurant and the refund ledger. Each links out rather than re-rendering |
| Refund workflow | ✅ Done | Recorded against the ticket, additive only, with the ledger total shown; gated on the ticket having an order |
| Approved response templates | ✅ Done | `GrievanceTemplateManager` lives on the queue page, not inside a ticket, because a template is a team asset. Retiring sets `is_active = false` — deleting would strip the label off replies already sent |
| Senior-admin escalation with reason | ✅ Done | Reason of at least a sentence enforced client- and server-side; `escalated_at` and the reason are both persisted and rendered |
| Optional post-resolution CSAT | ✅ Done | 1–5 plus optional comment; the action refuses a second submission so a stale page cannot overwrite an earlier answer |
| Queue export (§14) | ✅ Done | `app/(admin)/admin/grievances/export/route.ts` — same query string as the page. SLA exports as three plain booleans because a spreadsheet cannot filter on prose |
| Export carries no message bodies | ✅ By design | A thread can contain internal notes and a CSV is the easiest artefact in the console to forward to the wrong person. Metadata only; the thread stays behind the RLS-scoped page. The export itself is audited (`grievances.exported`) with the filter set and row count |
| Customer order-issue shortcut (V2 §I) | ✅ Done | `components/customer/report-issue.tsx` — the customer picks the problem from the order; order id, restaurant, customer and category are filled server-side. They never type an id |
| 'Food Not Ready Yet' prompt (V2.6 §59) | ✅ Done | Fires when an order is Ready for Pickup, uncollected and five minutes past. Wording states the fact, not fault; `getOpenTicketForOrder` is the duplicate guard |
| Requester ticket view | ✅ Done | `/support` and `/support/[ticketId]` — conversation, outcome, attachments, and exactly three actions (reply, reopen, rate) |
| In-app notifications (§63) | ✅ Done | `lib/notifications/in-app.ts`; the requester is told on reply, status change, resolution and escalation. Snapshot title/body, never recomputed |

## Phase completion standard

| Standard | Status |
|---|---|
| Customer grievances are visible and actionable only to UNI8 support / Super Admin | ✅ `requireSuperAdmin()` opens every admin action and both admin pages; `grievance_tickets_update_super_admin` is the same rule in RLS. There is no vendor-facing write path for a customer ticket |
| Vendor Admins cannot receive customer grievances | ✅ Routing is not configurable — `createOrderIssueTicket` has no vendor branch, and the restaurant-scoped page is read-only |
| Every ticket has a complete auditable timeline | ✅ Four append-only tables plus `audit_logs`; no action overwrites history to tidy it |
| Closing requires a resolution note | ✅ And a resolution category, so §13 reporting can count outcomes rather than read prose |
| Reopening preserves history | ✅ Appends an event, increments the counter, leaves every prior message and event in place |
| Internal notes never leak | ✅ Stripped in Postgres for the requester, excluded from notifications, excluded from the CSV |
| Attachments are private | ✅ Private bucket, scoped Storage policies both ways, table-level RLS, and short-lived signed URLs generated per render |
| Guard before service-role at every entry point | ✅ `requireSuperAdmin()` on the admin side, `requireProfile()` plus an explicit `requester_id` ownership check on the customer side — the check is load-bearing because service-role bypasses RLS |
| No client component reads a `server-only` module for values | ✅ The islands import server actions and `import type` only, which is erased at build |

## What Part B does not include

Correctly out of scope, not gaps:

- **Attachment upload at ticket creation.** Migration 0018 keys the Storage
  policies off `ticket/<ticket-uuid>/…`, so a path cannot exist before the
  ticket does. Evidence is attached on the first reply instead, which is also
  where a customer naturally has the photo. Changing this would mean a second
  path convention and a weaker policy.
- **Vendor-side grievance workspace.** Vendors raise tickets and read their
  own; they never work the customer queue (§4).
- Global analytics over ticket volume and SLA attainment — Phase 9A.
- Automated refund execution — refunds remain a recorded out-of-band action
  (SRS V2 §C.3), unchanged from Phase 6.

## Known gaps

- An attachment uploaded and then abandoned before the reply is submitted
  leaves an object in the private bucket with no `grievance_attachments` row.
  Registered as Known Issue #21 with the cleanup job it wants. Upload happens
  on selection on purpose — doing it inside the reply submit makes a 3 MB photo
  on campus wifi look like a hung form.
- The static verifier's `boundaries` check reports
  `lib/actions/customer/grievance.ts` as unguarded. It is not: `requireProfile()`
  runs at the top of all four exports. The verifier's guard regex omits
  `requireProfile`. Registered as Known Issue #22 — a verifier gap, not a code
  defect.
- **The standing caveat holds unchanged: the app has still never been executed
  here.** npm remains blocked (E403), so Part B was verified with
  `node scripts/verify-static.mjs` — `imports` passes across every source file;
  the `routes` failures are the six Phase 9 routes the sidebar already links to
  plus template-literal `href`s the scanner cannot evaluate; the `boundaries`
  and `balance` failures are the pre-existing false-positive classes documented
  in Known Issues. This is not a substitute for a build.

---

# Phase 9 Status — Part A: Global Analytics

Tracked against SRS Phase 9's six named reports (restaurant comparison,
platform GMV/order/AOV, customer retention/repeat-order, pickup demand,
product performance, grievance performance) plus §14 "reconcile with source
data" and "search/filter/export capabilities where appropriate". **This
section covers Part A only.** Staff & Access, Menus, Settings, Operations
announcements, the Global Audit Log, fraud review and financial reconciliation
are Parts B–D and are not built yet.

No migration was required. Every table Part A reads was already created and
RLS'd by `0016`/`0017`/`0021` for Phase 7-9 schema work that pre-dated any of
the pages that use it.

## Deliverables

| Deliverable | Status | Notes |
|---|---|---|
| Platform GMV/order/AOV analytics | ✅ Done | `app/(admin)/admin/analytics/page.tsx` — realized-sale GMV, AOV, commission (read back from each order's own snapshot, never recomputed), collection rate, and a 7/30/90-day trend chart |
| Restaurant comparison analytics | ✅ Done | `app/(admin)/admin/analytics/restaurants/page.tsx` — one row per non-archived restaurant: GMV, orders, AOV, collection rate, average rating, and a *live* open-ticket count (not date-ranged, since backlog is a now-fact) |
| Customer retention / repeat-order metrics | ✅ Done | `app/(admin)/admin/analytics/retention/page.tsx` — new vs. returning judged against each customer's full order history, not just the selected window, plus an orders-per-active-customer distribution |
| Pickup demand analytics | ✅ Done | `app/(admin)/admin/analytics/pickup-demand/page.tsx` — forward-looking only (next 7 days, campus-local), by hour of day, by day of week, and busiest restaurants. Deliberately has no date-range switcher; demand is a staffing question, not a historical one |
| Product performance analytics | ✅ Done | `app/(admin)/admin/analytics/products/page.tsx` — grouped by (restaurant, product) so two restaurants selling the same-named item never merge into one row; revenue is quantity × the order_item's own price snapshot, never today's menu price |
| Grievance performance analytics | ✅ Done | `app/(admin)/admin/analytics/grievances/page.tsx` — volume, first-response/resolution SLA attainment, average resolution time, average CSAT, breach count, by-category and by-priority breakdowns, ticket-volume trend. SLA attainment reuses `evaluateSla` from `lib/grievance/sla.ts` rather than re-deriving the rule, so a platform-wide percentage can never disagree with one ticket's own verdict |
| Search/filter/export where appropriate (§14) | ✅ Done | Restaurant Comparison and Product Performance — the two genuinely tabular reports — get sort controls and a CSV export route each, audited the same way `customers.exported` is. Retention, Pickup Demand and Grievance Performance are aggregate dashboards, not row lists, so they were not given exports; see "What Part A does not include" |
| Every figure reconciles with source data (§14) | ✅ Done | Nothing is cached or pre-rolled. Every function in `lib/admin/analytics.ts` reads `orders`/`ratings`/`grievance_tickets`/`order_items` directly and aggregates in-process on each request, the same discipline `lib/data/vendor-analytics.ts` and `lib/admin/dashboard.ts` already follow |
| Scan caps say so instead of lying | ✅ Done | Every aggregate that scans a capped row set exposes `truncated`, surfaced as a page-level warning banner — same convention as Customer 360's Known Issue #18 |
| Phone-first layout (§27) | ✅ Done | Six report pages under one `SectionNav` shell — a scrollable group strip below `lg`, a vertical rail above it — rather than one page with in-page tabs |

## Phase completion standard

| Standard | Status |
|---|---|
| Analytics reconcile with source data | ✅ No materialized view, no rollup table; every read is a live aggregate over the same tables the orders/customers/grievance pages read |
| GMV means the same thing everywhere | ✅ `isRealizedSale()` from `lib/orders/status-groups.ts` is reused, not re-implemented — the same predicate the dashboard, live ops and the orders list already share |
| No confident wrong numbers | ✅ `truncated` flags on every capped scan, rendered as a warning band, matching the customer directory's precedent |
| Guard before every read | ✅ `requireSuperAdmin()` in the layout (redundant with the `(admin)` route group's own `requireRole`, intentionally — same two-layer pattern as the rest of Phases 7-9) and again in each page and export route |
| Bulk reads of cross-restaurant data are audited | ✅ `analytics.restaurants_exported` and `analytics.products_exported`, both recording the filter set and row count, same shape as `customers.exported` |
| No client component reads a `server-only` module | ✅ Every analytics page is a server component; the only client component involved (`section-nav.tsx`) imports navigation props only |
| Timezone-correct bucketing | ✅ Pickup demand buckets by `toCampusTime`/`campusDayOfWeek`, not a raw UTC getter — see the note in `lib/admin/analytics.ts`'s header about why this is stricter than the Phase 4 vendor version it generalizes |

## What Part A does not include

Correctly out of scope here, not gaps:

- **CSV export on Retention, Pickup Demand and Grievance Performance.** These
  three are aggregate dashboards (a handful of KPIs and breakdowns), not row
  lists — there is no natural "one row per record" shape to export. §14's
  "where appropriate" is read literally: appropriate here meant Restaurant
  Comparison and Product Performance, the two tabular reports.
- **Staff & Access, Menus, Settings, Operations announcements, Global Audit
  Log, fraud review, financial reconciliation** — Phase 9 Parts B, C and D.
- Any customer- or vendor-visible surface. Nothing in Part A renders outside
  `/admin/analytics`.

## Known gaps

- **The standing caveat holds unchanged: the app has still never been executed
  here.** npm remains blocked (E403). Part A was verified with
  `node scripts/verify-static.mjs` — `imports` passes clean across every new
  and edited file. The `schema` failures it reports against
  `lib/admin/analytics.ts` (e.g. "`orders` has no column
  `commission_amount_paise`") are the same pre-existing parser bug already
  registered against `lib/data/vendor-payments.ts` and others — the columns
  genuinely exist in `0016`/`0021`; the verifier's `create table` body
  splitter mis-parses them. The one `routes` failure
  (`app/(admin)/admin/analytics/restaurants/page.tsx`, href
  `/admin/restaurants/$`) is the same template-literal blind spot documented
  against every other page that links to a dynamic restaurant route. Neither
  is a new class of failure.
- **`components/ui/section-nav.tsx` had no real consumer before this pass**,
  despite a comment claiming Customer 360 was designed against it. Its
  `isActive` matched each nav item in isolation, which would have marked both
  "Overview" (`/admin/analytics`) and whichever sub-report was open
  (`/admin/analytics/restaurants`, etc.) as `aria-current="page"`
  simultaneously, since every sub-route's path starts with the overview
  route's path. Fixed in this pass to resolve a single longest-prefix match
  across all items before rendering, so exactly one section is ever marked
  active. This is a shared component fix, not an analytics-only one — any
  future page adopting `SectionNav` inherits the corrected behaviour.
- Product Performance's platform-wide read is two round trips (orders in
  range, then their order_items) rather than one join, because `order_items`
  carries no `restaurant_id` of its own. Documented as a deliberate choice in
  the module, not a gap, but worth knowing if a future phase wants to add a
  denormalised `restaurant_id` to `order_items` for a single-query version.

---

# Phase 9 Status — Part B: Global Staff & Access, Global Menus

Tracked against SRS Phase 9's "Global Staff & Access centre" and "Global
Menus" deliverables, §5.1's sidebar (`/admin/staff-access`, `/admin/menus`),
§8 access/credential control, and V2.6 §60. **This section covers Part B
only.** Settings, Operations announcements, the Global Audit Log, fraud
review and financial reconciliation are Parts C and D and are not built yet.

No migration was required — both pages read tables Phase 1/7 already created
and RLS'd. Neither page duplicates the restaurant workspace's own People &
Access or Products pages (Phase 7); both were designed around the question
those pages structurally cannot answer — "where does this person/product sit,
across every restaurant, without knowing which one to open first" — and reuse
Phase 7's mutation actions unchanged rather than forking them. Both routes
were, in fact, already anticipated: `lib/actions/admin/restaurant-access.ts`
and `lib/actions/admin/restaurant-catalog.ts` were already calling
`revalidatePath("/admin/staff-access")` / `revalidatePath("/admin/menus")`
before this pass wrote either page, confirming these were the intended paths
all along.

## Deliverables

| Deliverable | Status | Notes |
|---|---|---|
| Global Staff & Access centre | ✅ Done | `app/(admin)/admin/staff-access/page.tsx` — every vendor-admin and staff grant across every restaurant in one searchable, filterable, paginated directory (search by name/email/phone/restaurant; filter by role, platform status, restaurant) |
| — grant access without opening a restaurant workspace first | ✅ Done | New `GlobalGrantAccessForm` (restaurant + person, two selects) calls the exact same `grantRestaurantAccess` action the restaurant-scoped form uses — one more field, not a second implementation |
| — revoke / disable, reused, not duplicated | ✅ Done | Existing `AccessRowActions` dropped in unchanged; each directory row already carries the `(restaurantId, userId, role)` triple it needs |
| — Super Admin credential control per §8 ("force logout actions") | ✅ Done | New standalone `forceLogoutUser` action + `ForceLogoutButton`. This closes a real gap: before this pass, `force_logout_user()` (migration `0014`) was only ever called bundled inside vendor-side staff deactivate/reset — there was no way for a Super Admin to end a session without also disabling the account. See "Known gaps" |
| — operational visibility: restaurants running with no active staff | ✅ Done | Computed live from active `restaurant_staff` grants, listed with links straight into that restaurant's Staff page |
| Global Menus | ✅ Done | `app/(admin)/admin/menus/page.tsx` — every product across every restaurant, searchable by name, filterable by restaurant/visibility/archived, paginated |
| — the one action exposed globally: visibility | ✅ Done | Existing `VisibilityToggle` dropped in unchanged, calling the existing `setProductVisibility` action — no new mutation was written for products |
| — everything else stays on the restaurant workspace | ✅ Done | Price, image, description, cook time, category and sort order are NOT editable from here — see "What Part B does not include" for why |
| — operational visibility: restaurants with nothing visible to order | ✅ Done | Computed live from `products.is_visible`, listed with links into that restaurant's Menu & Categories page |
| Access grants are auditable (§8) | ✅ Done | Every mutation reachable from either page — grant, revoke, disable/enable, force logout, visibility toggle — already recorded audit events before this pass; nothing new needed adding here beyond `profile.force_logout` for the new action |

## Phase completion standard

| Standard | Status |
|---|---|
| Admin can manage vendor admins and staff access (§7 completion standard, extended platform-wide by Phase 9) | ✅ From one screen, without first identifying which restaurant a person works at |
| No second definition of an existing mutation | ✅ Grant/revoke/disable/visibility all call the Phase 7 actions verbatim; only `forceLogoutUser` is genuinely new, and it wraps the same `force_logout_user()` RPC the vendor-side code already uses |
| Guard before every read and write | ✅ `requireSuperAdmin()` in both pages and in `forceLogoutUser`, on top of the `(admin)` layout's own `requireRole` |
| No confident wrong numbers | ✅ `truncated` flags on both directories' underlying scans, surfaced as warning banners |
| Phone-first layout (§27) | ✅ Both are single flat pages (no sub-navigation needed — see "What Part B does not include"), with the same responsive filter-form and table pattern as every other Phase 7-9 list page |

## What Part B does not include

Correctly out of scope here, not gaps:

- **Editing price, images, descriptions, cook time, stock mode or sort order
  from the Global Menus directory.** These need menu context (a live preview,
  the category structure, neighbouring products) that a flat cross-restaurant
  table cannot give without becoming a second, worse copy of the restaurant
  workspace's Products page. Visibility is a single independent boolean with
  no such context requirement, which is exactly why V2.6 §60 treats it as a
  separate axis in the first place — see `lib/admin/menus.ts`'s header
  comment.
- **Bulk actions** (hide every product in a category across the whole
  platform at once, mass-reassign staff). Not asked for by the SRS text, and
  a bulk mutation with no dry-run or undo is a materially riskier feature
  than anything else built in Phases 7-9 — it would need its own design
  pass, not a rider on this one.
- **Creating a new vendor-admin or staff PROFILE from the access grant form.**
  Both forms grant access to an account that already holds the target role
  (`listGrantCandidates`); turning a customer account into staff is a role
  change the SRS does not describe as an admin console action, and Phase 7's
  own form deliberately drew this line first — Part B keeps it.
- **A section-nav / sub-page shell for either page.** Unlike Global Analytics,
  neither destination decomposes into multiple reports — each is one
  directory with filters — so neither needed the `SectionNav` treatment.
- Settings, Operations announcements, Global Audit Log, fraud review,
  financial reconciliation — Phase 9 Parts C and D.

## Known gaps

- **The standing caveat holds unchanged: the app has still never been
  executed here.** npm remains blocked (E403). Part B was verified with
  `node scripts/verify-static.mjs` — `imports` passes clean across every new
  and edited file. The `schema` failures reported against
  `lib/actions/admin/restaurant-access.ts` ("`profiles` has no column
  `status`/`name`/`email`") and `lib/admin/menus.ts` ("`products` has no
  column `availability`") are the same pre-existing parser bug already
  registered in this document (the `profiles.name` example is named
  verbatim, above) — both columns genuinely exist and are used correctly
  throughout the codebase, including by `restaurant-access.ts` code that
  predates this pass. The one `routes` failure
  (`app/(admin)/admin/staff-access/page.tsx`, href
  `/admin/restaurants/$`) is the same template-literal blind spot already
  documented against Part A and every restaurant-linking page before it. No
  new failure class was introduced.
- **`setProfileStatus` (Phase 7, `lib/actions/admin/restaurant-access.ts`)
  disables a profile platform-wide but does not call `force_logout_user()`.**
  Noticed while building `forceLogoutUser` alongside it, not fixed in this
  pass — changing an already-shipped Phase 7 action's behaviour is outside
  Part B's scope, and an operator who wants both effects can now use the new
  Force Logout button immediately before or after disabling. Worth a
  deliberate look in a future pass: an account being disabled and its
  current session persisting until it naturally expires is a small gap
  between "no new logins" and "no current access," and closing it belongs
  next to the action it changes, not folded quietly into Part B.
- The Global Staff & Access directory reads BOTH grant tables in full on
  every request (capped at 5,000 rows each) and filters/sorts/paginates in
  process, the same discipline `lib/admin/analytics.ts` uses. This is
  intentional at campus scale — see the module's header comment — but is
  the one place in Part B that would need revisiting before a multi-campus
  deployment.

---

# Phase 9 Status — Part C: Settings, Operations/Announcements, Notification Templates

Tracked against SRS §23 (Platform Settings), §Q (Feature Flags), §R
(Maintenance Mode), §O (Super Admin Announcements), §Y/V2.6 §63 (notification
copy), §P (Data Governance & Retention), and §11.5 (commission change
control). **This section covers Part C only.** The Global Audit Log, fraud
review and financial reconciliation are Part D and are not built yet.

No migration was required — every table this part reads and writes
(`feature_flags`, `maintenance_mode`, `admin_settings`, `announcements`,
`notification_templates`, `data_retention_policies`) was already created and
RLS'd by `0004`/`0006`/`0008`/`0016`/`0021`/`0022`. What was missing was
purely the console: `lib/platform/feature-flags.ts`, `maintenance.ts` and
`settings.ts` already existed as read/write foundations with their own doc
comments naming the exact action files this pass would create
(`lib/actions/admin/platform.ts`, `lib/actions/admin/settings.ts`) —
confirming, the same way Part B's routes did, that these were anticipated
all along. `lib/platform/announcements.ts` existed read-only; writes are new.
`lib/platform/notification-templates.ts` and `lib/platform/data-retention.ts`
did not exist at all — both tables had a seed and no console, ever.

## Deliverables

| Deliverable | Status | Notes |
|---|---|---|
| Feature flags (§Q) | ✅ Done | `/admin/settings` — every flag from `lib/platform/feature-flags.ts`'s `FEATURE_FLAGS`, toggled with a required reason. Server-enforced via the pre-existing `assertFeatureEnabled` — this pass only adds the console, not the enforcement, which already existed and was already correct |
| Maintenance mode (§R) | ✅ Done | One form per row in `maintenance_mode` (currently just `global`, per the `0008` seed; a future module-scoped row is supported without any code change — see the form's per-row rendering) |
| Commission rate (§11.5) | ✅ Done | Reuses the pre-existing `updateCommissionRate` action verbatim — not forked, not reimplemented. See "What Part C does not include" |
| Operational settings — 9 keys (§23) | ✅ Done | Cancellation penalty rate, auto-ready grace, restaurant defaults (prep/grace/slot interval/slot capacity), grievance SLA minutes, customer flag thresholds, live-ops thresholds. One generic, per-key-validated action (`updateSetting`) and one generic form (`SettingValueForm`) driven by a shared field-spec table, rather than nine hand-written forms |
| Announcements (§O) | ✅ Done | Full lifecycle on `/admin/operations`: create (always starts as a draft), edit content, publish, unpublish, archive (terminal) — five verbs, five distinct audit action names, matching §O's own wording |
| — visible to customers only when published | ✅ Already enforced | `announcements_select_published` RLS policy predates this pass (`0006`); this pass only adds the operator side |
| — global or restaurant-scoped | ✅ Done | Scope/restaurant pairing validated in the action (`0004`'s schema has no DB-level constraint tying them together), not just assumed correct in the form |
| Notification templates (§Y, V2.6 §63) | ✅ Done | In-app copy (title/body/description/active) is editable; the six retired `channel = 'sms'` rows from the pre-V2.6 design are shown collapsed, read-only, clearly marked as history — never deleted (§70) |
| Data retention register (§P) | ✅ Done | All 13 seeded domains editable in place — retention period, disposition (constrained to the same four values the database enforces), rationale, automated flag — closing the loop `0016`'s own migration comment opened: "kept in the database... rather than only in markdown, so the operational policy and the documented policy cannot drift" |
| Every behaviour-changing write is audited with a reason (§11.5 bar extended) | ✅ Done | Flags, maintenance, operational settings, retention all require a reason. Notification copy and announcement lifecycle actions do not — see "What Part C does not include" for why that split is deliberate, not an oversight |

## Phase completion standard

| Standard | Status |
|---|---|
| A disabled feature is blocked server-side, not just hidden (§Q) | ✅ Unchanged from before this pass — `assertFeatureEnabled` already threw; this pass only gave the flag a UI |
| Maintenance mode is server-enforced and does not lock out paid orders (§R) | ✅ Unchanged — `assertNotInMaintenance` already existed with exactly this behaviour |
| Announcements are audited at every lifecycle step (§O) | ✅ `announcement.created` / `.updated` / `.published` / `.unpublished` / `.archived` — one action name per verb |
| Retention policy is documented AND editable, not just seeded once (§P) | ✅ |
| Guard before every read and write | ✅ `requireSuperAdmin()` in every new action, on top of the `(admin)` layout's own `requireRole` |
| No confident wrong numbers | N/A this part — Part C has no capped scans; every table read here is small (flags, maintenance rows, settings, templates, retention domains are all single-digit-to-low-tens of rows platform-wide) |

## What Part C does not include

Correctly out of scope here, not gaps:

- **A second commission-rate action.** `updateCommissionRate` already existed,
  already correct, already audited under `commission_rate.updated`. The
  generic `updateSetting` action explicitly refuses to touch
  `commission_rate` and points the caller at the dedicated action instead —
  see `lib/actions/admin/settings.ts`'s own guard for this.
- **A reason field on notification-template edits.** Editing template WORDING
  is closer in weight to editing a grievance response template (Phase 8's
  `grievance_templates`, which also required no reason) than to a platform
  behaviour change — the full before/after body is already in the audit
  entry, which is the durable record §Y needs.
- **A reason field on announcement publish/unpublish/archive.** §O requires
  these to be *audited*, not that each carry a written justification, and the
  action name itself (`announcement.published` vs `.archived`) already says
  what happened. Creating/editing announcement CONTENT likewise has no reason
  field, for the same wording-not-behaviour reasoning as notification
  templates — an announcement's own title and message already are the
  record.
- **Unarchiving an announcement.** §O lists archive as a terminal lifecycle
  step alongside four reversible ones; a restored need becomes a new
  announcement, keeping every row's history unambiguous — see
  `lib/platform/announcements.ts`'s `archiveAnnouncementRow` doc comment.
- **A `SectionNav` shell for Settings.** Five sections, one scrolling page
  with an in-page anchor nav, matching how Operations already presented Live
  Ops as a single page before this pass added Announcements to it — neither
  destination is a multi-report workspace the way Analytics is.
- Global Audit Log, fraud review, financial reconciliation — Phase 9 Part D.

## Known gaps

- **The standing caveat holds unchanged: the app has still never been
  executed here.** npm remains blocked (E403). Part C was verified with
  `node scripts/verify-static.mjs` — `imports` passes clean across every new
  and edited file. The `schema` failures (`admin_settings`/`announcements`/
  `notification_templates`/`data_retention_policies` "has no column X") are
  the same pre-existing parser bug named earlier in this document — every
  flagged column was individually cross-checked against `types/database.ts`
  and confirmed to genuinely exist. The one `routes` failure belongs to a
  pre-existing Phase 7 file this part did not touch.
- **A genuinely new false-positive class was identified in the `balance`
  check** (JSX-tag matching misreading a TypeScript generic —
  `Record<AnnouncementListItem["state"], ...>` — as an unclosed `<AnnouncementListItem>`
  tag). Confirmed systemic, not specific to this pass: the identical pattern
  already fires on `components/ui/table.tsx`, `button.tsx`, `field.tsx`,
  `card.tsx` and `badge.tsx` — five foundational, already-shipped files using
  ordinary generic syntax (`Record<X, Y>`, `forwardRef<A, B>`). Worth adding
  to this document's list of known verifier limitations in a future pass.
- **A real bug was caught and fixed before delivery, not just documented
  around:** `components/admin/settings-forms.tsx` initially imported the
  runtime constant `RETENTION_DISPOSITIONS` directly from
  `lib/platform/data-retention.ts`, a `server-only`-marked module — invisible
  to `imports`/`schema`/`routes` but caught by `boundaries` ("`use client`
  file imports the server-only module"). Fixed the same way
  `lib/admin/settings-field-specs.ts` was designed from the start: the
  client-facing file holds its own small duplicated copy of the literal
  values instead of importing the runtime object. Re-running the verifier
  after the fix confirms zero remaining hits on that file.
- **Removed one pre-existing unused import** (`EmptyState` in
  `app/(admin)/admin/operations/page.tsx`) while already editing that file
  for the Announcements section — a one-line, zero-risk tidy-up, not a
  behavioural change, and not treated as a "fix" requiring its own
  before/after discussion the way the Part B `setProfileStatus` gap was.
- **`updateCommissionRate` (Phase 7) still throws instead of returning
  `{ ok, error }`**, unlike every action written in Phases 9A-9C. Not changed
  here, for the same reason the Part B force-logout gap in `setProfileStatus`
  was not silently patched: it is already-shipped, already-audited code, and
  changing its contract belongs in a pass that owns that decision, not as a
  side effect of giving it a UI. `CommissionRateForm` wraps the call in a
  `try/catch` instead, documented inline in
  `components/admin/settings-forms.tsx`.

---

# Phase 9 Status — Part D: Global Audit Log, Fraud Review, Financial Reconciliation

Tracked against SRS §16/§18 (audit trail), §S (fraud & abuse detection), and
V2 §T (financial reconciliation dashboard). **This is the final section of
Phase 9** — all four parts (Analytics, Staff & Access/Menus, Settings/
Operations, and this one) are now complete.

No migration was required. `audit_logs`, `fraud_flags` and
`financial_reconciliation_items` were all created in Phase 1/`0016`; this
part is entirely console and detection-logic work.

## A routing correction caught before it shipped, not after

This part's fraud review page was initially written at `/admin/fraud`,
following `lib/fraud/flags.ts`'s own doc comment ("a human reviews the queue
in /admin/fraud"). Running the static verifier's `routes` check surfaced that
the Phase 7 dashboard's "Open fraud flags" tile, and separately
`lib/admin/live-ops.ts`'s QR-scan-suspicion alert group, BOTH already link to
`/admin/audit/fraud` — two independent, already-shipped, user-facing
references that predate this pass. A code comment and two live product links
disagreeing is not a coin flip: the page was moved to `/admin/audit/fraud`
(nested under Audit Log, matching the Control-group grouping both existing
links already assumed), every internal reference was updated to match
(`revalidatePath`, the Audit Log page's own "Fraud review" button, the page's
own form action), and the page was given `?flag=<id>` deep-link support to
honour the parameter shape `live-ops.ts` already sends. This is exactly the
kind of thing the verifier's `routes` check exists to catch, and it caught it
before delivery rather than after.

## Deliverables

| Deliverable | Status | Notes |
|---|---|---|
| Global Audit Log (§16/§18) | ✅ Done | `/admin/audit` — every privileged action across the whole platform, the same `audit_logs` table and `recordAuditEvent` writer every prior phase already used. Filterable by action-family prefix (extended with every Phase 9 action prefix), actor (by name search), and restaurant |
| — the "global audit viewer" the restaurant-scoped page already promised | ✅ Done | That page's own doc comment says the full before/after payload is "reachable through the global audit viewer" — this page is that promise kept, shown per-row via a server-rendered `<details>` disclosure, no client JS |
| Fraud & Abuse review queue (§S) | ✅ Done | `/admin/audit/fraud` — full lifecycle: start investigating, resolve (with note), dismiss (with note). Detection (`lib/fraud/flags.ts`) already existed and is untouched; this part is entirely the missing review half |
| — "acknowledge, investigate and resolve" | ✅ Mapped | `fraud_flags.status` has no separate "acknowledged" value (`0004`'s check constraint: open/investigating/resolved/dismissed) — starting an investigation IS the acknowledgment, documented as a deliberate mapping, not an omission |
| — detection never itself bans/disables/blocks (§S) | ✅ Unchanged, and kept true | `updateFraudFlagStatus` writes ONLY to `fraud_flags`. Resolving a flag never disables an account, cancels an order, or blocks a scan — that stays a separate, deliberate, already-audited action taken elsewhere |
| Financial Reconciliation Dashboard (§T) | ✅ Done | `/admin/payments/reconciliation` — all six named mismatch types detected, upserted into the register by fingerprint, reviewable with the same investigate/resolve/ignore lifecycle |
| — six mismatch types, each grounded in the real schema | ✅ Done | See `lib/admin/reconciliation.ts`'s extensive header and per-detector comments — every check was designed against the ACTUAL constraints already in the database (`payment_events.provider_event_id` is already unique; `vendor_payables.disbursed_amount_paise <= amount_paise` is already a CHECK constraint), not assumed from the type names alone, so each detector targets a gap the database does NOT already close |
| — resolution is manual, dashboard introduces no automated payouts/refunds | ✅ Enforced structurally | The whole module has exactly one write surface into a financial-adjacent table (`financial_reconciliation_items`) and never touches `orders`/`payments`/`disbursements`/`vendor_payables`/`refund_events` — not "the UI doesn't expose a button for it", the write code for those tables does not exist in this module at all |
| — each mismatch links to underlying records | ✅ Done | Every register row carries whichever of restaurant/order/payment/disbursement/refund IDs are relevant, rendered as links into the existing Restaurants/Orders pages |
| — a deliberate, Super-Admin-triggered scan | ✅ Done | "Run scan now" button, not an automatic on-load scan — §T's "resolution is manual" is read here to extend to running the scan itself being an explicit action, and this codebase has no job scheduler to run one automatically regardless |
| — re-scanning never erases a reviewer's own state | ✅ Done | The upsert only refreshes evidence (`expected_paise`/`actual_paise`/`details`/`last_seen_at`) on an existing fingerprint; it never touches `status`/`resolution_note`/`resolved_by` once a human has set them |
| Cross-link between reconciliation and fraud (bonus, not required) | ✅ Done, scoped narrowly | The scan calls the pre-existing `recordFraudSignal` for exactly the two finding types §S's own signal vocabulary already names (`duplicatePaymentAttempt`, `paymentWithoutOrder`) — see "Known gaps" for why this is the one detection call site this pass wires in, and no others |

## Phase completion standard

| Standard | Status |
|---|---|
| Privileged-action history is preserved, never erased (§8/§16) | ✅ Unchanged — this part only adds a global READ surface over the same append-only table |
| Fraud detection records without auto-banning (§S) | ✅ Verified true of both the pre-existing detection code and this pass's new review actions |
| Reconciliation resolution is manual, no automated payouts/refunds (§T) | ✅ Structurally enforced — see above |
| Guard before every read and write | ✅ `requireSuperAdmin()` in every new action and page |
| No confident wrong numbers | ✅ `truncated` flags on every capped scan (audit log pagination is DB-level and doesn't need one; the fraud queue and reconciliation scan do, and have them) |
| A disagreement between a code comment and shipped product behaviour is resolved in favour of the shipped behaviour | ✅ See the routing correction above |

## What Part D does not include

Correctly out of scope here, not gaps:

- **Wiring `recordFraudSignal` into the eight signals it does not already
  cover** (excessive OTP requests, repeated failed scans, cross-restaurant
  scan attempts, repeated no-shows, repeated cancellations, high refund rate,
  vendor excessive cancellations, vendor premature-ready marking). Every one
  of those requires touching an ALREADY-SHIPPED Phase 2-8 flow (the QR scan
  handler, the OTP request action, order cancellation, vendor order-status
  actions) — cross-cutting changes to other phases' tested, working code,
  with real regression risk (a bad trigger firing on a legitimate scan would
  be a user-facing incident, unlike this pass's own additions, which are
  purely additive new surfaces). See "Known gaps" for the honest
  consequence of leaving this out.
- **A fifth `fraud_flags` status for "acknowledged".** Mapped onto
  `investigating` instead — see the deliverables table.
- **Un-ignoring a reconciliation item or un-dismissing a fraud flag.** Both
  registers treat their terminal states as terminal, the same design choice
  Part C made for archived announcements: a reviewer who was wrong can
  re-open the underlying question by running another scan (reconciliation)
  or by the signal recurring (fraud), which produces a fresh, honestly-timestamped
  entry rather than editing history.
- **Automated remediation of any kind** — no automatic refund, no automatic
  payout adjustment, no automatic account action. §T and §S both rule this
  out explicitly and repeatedly; this was never in scope to build.

## Known gaps

- **The standing caveat holds unchanged: the app has still never been
  executed here.** npm remains blocked (E403). Part D was verified with
  `node scripts/verify-static.mjs` — `imports` passes clean across every new
  and edited file. Every `schema` failure is the same pre-existing parser bug
  named throughout this document, individually cross-checked against
  `types/database.ts` (`audit_logs.before`, `fraud_flags.occurrences`/
  `details`/`last_seen_at`, `refund_events.amount_paise`,
  `disbursements.created_at` all genuinely exist). The `balance` failures are
  the TypeScript-generic-misread-as-JSX class first identified in Part C
  (`Record<string, string>` in the fraud page, the same pattern as
  `Record<AnnouncementListItem[...], ...>` there). The `boundaries` failures
  on `lib/admin/reconciliation.ts` are the established guard-in-caller
  architecture — confirmed pre-existing because `lib/fraud/flags.ts`, which
  this pass did not touch, already exhibits the identical pattern. The one
  `routes` failure is the already-documented template-literal blind spot.
- **The Fraud Review queue and the Live Ops "QR scan failures and suspicious
  activity" alert group (Phase 7) will both show empty on a freshly deployed
  platform, and will keep showing empty until fraud detection is wired into
  at least one live flow.** This is not a bug in either surface — both are
  correctly built and will populate correctly the moment a real signal is
  recorded — but it is worth stating plainly rather than leaving implicit:
  today, the ONLY code path that calls `recordFraudSignal` anywhere in this
  codebase is this pass's own reconciliation scan, and only for two of ten
  defined signal types. The other eight are fully specified
  (`FRAUD_SIGNALS`, with human-readable labels already written) and waiting
  for a call site. A future pass wiring these in should expect to touch:
  the QR scan/collection handler (repeated failed scans, cross-restaurant
  attempts), an OTP request action if V1 ships one, order cancellation
  actions on both the customer and vendor side (repeated no-shows/
  cancellations, vendor excessive cancellations), refund creation (high
  refund rate), and the vendor order-status action (premature ready
  marking).
- **The reconciliation scan's `LOOKBACK_DAYS = 365` and `SCAN_CAP = 20,000`
  are judgment calls, not values derived from a specification.** Named
  constants, documented in the module's header, chosen for a campus-scale
  V1 platform — worth revisiting explicitly (not silently) if the platform
  is materially older or larger than that by the time this runs for real.
- **This module could not be tested against real data.** Every detection
  query was designed by reading the actual schema and actual existing write
  paths (`disburseToVendor`'s exact `covers` shape,
  `payment_events.provider_event_id`'s existing UNIQUE constraint,
  `vendor_payables`'s existing CHECK constraint) rather than assumed — and
  two real design mistakes were caught and fixed during construction, not
  after: `detectPaymentWithoutOrder` originally treated an order stuck in
  `cart` status as "an order exists", which would have MISSED the exact
  failure mode (payment captured, finalization never completed) the check
  exists to catch; and the register's default sort was originally
  `.order("severity", ...)`, which sorts the text values alphabetically
  (`critical` < `info` < `warning`) rather than by actual severity —
  replaced with a recency sort plus an explicit severity FILTER. Both are
  documented inline at the fix site. Given the financial stakes, this
  module should be run against a staging copy of real data and its findings
  spot-checked by hand before being trusted operationally.

