# UNI8 — Campus Food Ordering Platform

> Scheduled Pickup • Vendor Operations • Super Admin Control
> "Your class ends. Your food is ready."

This is the UNI8 monorepo: Next.js App Router + TypeScript frontend/backend,
Supabase (Postgres + Auth + Storage) as the system of record, Razorpay for
customer payments.

**Governing document:** `/docs/SRS.md` is not included in this repo (it's the
external SRS PDF supplied by the product owner) — treat the original 25-page
V1 SRS + V2 addendum + V2.1 brand addendum as the single source of truth for
all product/functional requirements. This README covers *setup*, not
*requirements*.

**Current status:** Phases 1–8 complete in source form — Foundation & Access;
Customer Discovery, Cart & Scheduling; Razorpay, Orders & QR Pickup; Vendor
Admin Operations; Staff Portal & Restaurant Operations; Payments, Manual
Disbursement & Vendor Grievances; the Super Admin Command Center & the
fourteen-tab restaurant workspaces (Phase 7); Customer 360 (8A) and the central
grievance CRM (8B). Phase 9 (global analytics, platform settings, audit/fraud
UI, customer auth migration, in-app notification centre) and Mandatory
Handover 3 are outstanding. See `docs/PHASE_STATUS.md` for exactly what is and
isn't built per phase, `docs/KNOWN_ISSUES.md` for every deferred item, and
`docs/PHASE_GATE_ACCEPTANCE_RECORD_1.md` for the Developer 2 verification of
Phases 1–3. The standing caveat across every phase is unchanged: the app has
never been executed (`npm install`/build) in this environment — see
`docs/TEST_REPORT.md`.

---

## 1. Prerequisites

- Node.js ≥ 20
- npm ≥ 10
- A Supabase project (free tier is fine for local/staging)
- The [Supabase CLI](https://supabase.com/docs/guides/cli) (`npm i -g supabase` or via your package manager)
- A Razorpay test account (for Phase 3 onward)

## 2. First-time setup

```bash
# 1. Install dependencies
npm install

# 2. Copy the environment template and fill in real values.
#    NEVER commit .env.local.
cp .env.example .env.local

# 3. Point the Supabase CLI at your project (or run `supabase init` +
#    `supabase start` for a fully local stack — see Supabase CLI docs).
supabase link --project-ref <your-project-ref>

# 4. Apply all migrations in supabase/migrations/, in order.
npm run db:migrate
# (equivalent to: supabase db push)

# 5. (Optional, local/staging only) seed sample restaurants/products:
npm run db:seed

# 6. (Optional, local/staging only) create one test account per role:
npx tsx scripts/seed-auth-users.ts

# 7. Run the app
npm run dev
```

Then visit:
- `/` — customer discovery
- `/auth/customer` — customer phone+OTP login
- `/auth/vendor` — Vendor Admin login (email+password)
- `/auth/staff` — Staff login (email+password)
- `/auth/admin` — Super Admin login (email+password)

## 3. Verifying the baseline (do this before starting new work)

Per SRS §24 ("Incoming developer must first restore/run the handed-over
system and verify the documented baseline before beginning new work"):

1. `node scripts/verify-static.mjs --only=imports,routes,balance,boundaries` —
   runs with **no dependencies installed**, so do this first. `imports` must
   pass; the other three currently report known false positives and six
   deliberately-unbuilt Phase 9 routes, all itemised in `docs/TEST_REPORT.md`.
   Do not "fix" the code to silence them.
2. `npm run typecheck` — expect real errors on the first ever run; no compiler
   has seen this code.
3. `npm run lint`.
4. `npm run build`.
5. Sign in on all four `/auth/*` routes with seeded test accounts and
   confirm each lands on the correct role-scoped page, and that visiting
   another role's route (e.g. a vendor_admin visiting `/admin/dashboard`)
   redirects away rather than rendering anything.
6. In the Supabase dashboard, confirm RLS is **enabled and forced** on
   every table under Database → Tables, and that `grievance-attachments` and
   `payout-proofs` are private buckets
   (`0006_rls_policies.sql`, `0017_phase7_9_rls.sql`, `0018`).

## 4. Project structure

```
app/
  (customer)/         # customer route group — account, cart, checkout, orders, support
  (vendor)/vendor/    # Vendor Admin dashboard route group
  (staff)/staff/      # Staff portal route group (exactly Orders + Scan)
  (admin)/admin/      # Super Admin Command Center: global screens + the
                      #   fourteen-tab restaurants/[restaurantId] workspace
  auth/               # login/onboarding pages for all four roles
  api/                # Route Handlers — currently just the Razorpay webhook
lib/
  supabase/           # browser / server / service-role Supabase clients
  auth/               # role model + server-side authorization guards
  audit/              # audit-log writer (the ONLY way to write audit_logs)
  storage/            # Supabase Storage bucket registry + path builder
  scheduling/         # hours/capacity/feasibility/walking-time engine (Phase 2)
  payments/           # Razorpay REST client (Phase 3)
  orders/             # order state machine, payment finalization, QR scan/collect
  notifications/      # SMS abstraction + in-app notifications (§63)
  grievance/          # attachment path fence + signed-URL reader (Phase 8B)
  fraud/              # customer flag evaluation
  data/               # role-scoped read helpers (Phases 4–6)
  admin/              # platform-wide read models (Phases 7–8)
  platform/           # settings, feature flags, maintenance, announcements
  actions/            # Server Actions, organized by role/domain
  money.ts            # paise↔rupee formatting — the only place that conversion happens
components/
  ui/                 # brand-token-driven primitives (Button, Card, ...)
  brand/              # brand asset rendering (Logo)
  auth/               # shared login form
  customer/           # discovery/cart/schedule/checkout/orders/support UI
  restaurant/         # scan UI shared by staff + vendor admin
  vendor/             # vendor management islands
  admin/              # Super Admin client islands (lifecycle, CRM, grievance workspace)
  grievance/          # shared attachment picker (customer + admin)
supabase/
  migrations/         # 22 numbered, ordered SQL migrations — the schema source of truth
  seed/               # dev-only sample data
scripts/
  verify-static.mjs   # dependency-free verifier — the project's actual test harness
  seed-auth-users.ts  # one test account per role
docs/                 # architecture, auth/RBAC, brand, known issues, phase status
```

## 5. Key architectural rules (see `docs/ARCHITECTURE.md` for full detail)

- **The browser is never trusted** for price, totals, payment state, QR
  validity, role/restaurant scope, or storage paths. Every privileged mutation
  happens in a Server Action or Route Handler that re-checks authorization
  itself.
- **Three independent authorization layers**: `middleware.ts` (fast,
  coarse route redirect) → `lib/auth/guards.ts` (fine-grained, inside every
  Server Action) → PostgreSQL RLS (`0006_rls_policies.sql` +
  `0017_phase7_9_rls.sql`, the actual enforcement floor). None of the three
  trusts the others alone.
- **Money is stored in paise** (integers) everywhere, never floating point.
- **Snapshots are never recomputed.** Commission amounts, SLA policy and
  notification copy are captured at the moment of the event; corrections are
  additive rows, never edits to history.
- **Commission/penalty rates are configuration, never constants** — see
  `admin_settings` and `lib/actions/admin/update-commission-rate.ts`.
- **Nothing is deleted** (§P): restaurants are archived, accounts are
  suspended via `profiles.status`, grievance timelines are immutable.
- **Every privileged action is audited** via `lib/audit/log.ts` — there is
  deliberately no client-writable RLS policy on `audit_logs`.
- **Private files**: the browser uploads under its own session so Storage RLS
  is the real check, a guarded action writes the binding row only after the path
  is proven in-scope, and reads are signed for 300 s. See
  `lib/grievance/attachments.ts`.

## 6. What's NOT in this repo yet

See `docs/PHASE_STATUS.md` for the per-phase record. Outstanding:

- **Phase 9A** — global analytics, audit-log viewer, fraud review queue, global
  menus, Staff & Access.
- **Phase 9B** — platform settings UI, announcements UI, walking-time matrix,
  payment reconciliation.
- **Phase 9C** — customer auth migration from OTP to password (V2.6 §62),
  in-app notification centre UI, §29.2 university access popup.
- **Mandatory Handover 3**, plus Phases 10 (security audit) and 11 (bug hunt /
  release), which are explicitly out of scope until asked for.

Six §5.1 sidebar destinations (`/admin/analytics`, `/admin/settings`,
`/admin/audit`, `/admin/audit/fraud`, `/admin/staff-access`, `/admin/menus`)
link to those unbuilt Phase 9 pages. That is deliberate — the navigation is a
transcription of the SRS table — and it is why the verifier's `routes` check
reports 21 problems.

**Nothing in this repository has been run.** No `npm install`, no build,
no live Supabase project, no real Razorpay payment, no file ever uploaded to a
bucket. See `docs/TEST_REPORT.md` for exactly what that means and a manual test
plan for whoever picks this up next.

## 7. Handover documents

Phase 3 completed SRS's Mandatory Handover 1. Start at `docs/HANDOVER_1.md` —
it indexes every required handover document (architecture, auth/RBAC, payments,
API/integration, known issues, test report, deployment, third-party inventory)
and summarizes what changed across Phases 1–3. `HANDOVER_1.md` and
`PHASE_GATE_ACCEPTANCE_RECORD_1.md` are historical records of that gate and are
deliberately **not** updated as later phases land; the living documents are
`PHASE_STATUS.md`, `KNOWN_ISSUES.md`, `ARCHITECTURE.md`, `AUTH_RBAC.md`,
`TEST_REPORT.md` and `DEPLOYMENT.md`. Mandatory Handover 3 (end of Phase 9) is
still to be produced.
