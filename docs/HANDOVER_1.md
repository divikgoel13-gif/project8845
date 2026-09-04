# Mandatory Handover 1 — After Phase 3

Per SRS §19, Developer 1 (Phases 1–3) must deliver this handover package
before Developer 2 begins Phase 4. This document indexes every required
item and summarizes the handover in prose. **Read `docs/TEST_REPORT.md`
first** — nothing in this handover has actually been executed, and that
context changes how everything else should be read.

## Handover checklist

| Required item | Where it is | Notes |
|---|---|---|
| Source ZIP | The delivered `.zip` itself | Complete project source, all phases |
| Environment template | `.env.example` | Every variable documented, zero real secrets |
| Database package | `supabase/migrations/0001`–`0011` | Ordered, numbered, reproducible. `supabase/seed/seed.sql` + `scripts/seed-auth-users.ts` for dev data |
| README | `README.md` | Setup, verification, project structure |
| Architecture document | `docs/ARCHITECTURE.md` | Stack, auth layers, scheduling engine, payments/QR pattern |
| Auth/RBAC document | `docs/AUTH_RBAC.md` | Roles, channels, restaurant-scoping pattern |
| API/integration document | `docs/API_INTEGRATION.md` | Route handlers, Server Actions, third-party integrations |
| Payment document | `docs/PAYMENTS.md` | Full Razorpay flow, idempotency, exception handling, test-mode setup |
| Known issues | `docs/KNOWN_ISSUES.md` | 17 items across three phases, none glossed over |
| Test report | `docs/TEST_REPORT.md` | What was verified by reasoning vs. never executed; manual test plan |
| Database backup/export | **Not applicable — see below** | No live database has ever existed to export |
| Deployment notes | `docs/DEPLOYMENT.md` | Target architecture, env vars, first-deploy steps |
| Third-party inventory | `docs/THIRD_PARTY_INVENTORY.md` | Every dependency, purpose, license |
| Handover notes | This document | What changed, current state, next tasks |

### On "Database backup/export"

The SRS asks for "current non-secret development/staging database
schema/data export sufficient to restore the environment." No such
database exists — this entire project was authored in a sandboxed
environment with no network access to a live Supabase project (see
`docs/TEST_REPORT.md`). The substitute is that `supabase/migrations/` +
`supabase/seed/seed.sql` are fully reproducible from empty — running them
against a fresh Supabase project IS the restore procedure, just never
executed here. This is a materially different (weaker) guarantee than an
actual export of a running system, and should not be treated as
equivalent — it's what's honestly available given the constraint.

## What changed across Phases 1–3

**Phase 1** — Foundation: Next.js/TypeScript/Supabase scaffold, full
database schema for the entire platform (not just Phase 1's immediate
needs — later phases build on it rather than migrating it), RLS on every
table, three-layer authorization (middleware → guards → RLS), audit
logging, brand token extraction from the supplied assets, auth for all
four roles.

**Phase 2** — Customer Discovery, Cart & Scheduling: restaurant/menu
browsing, multi-restaurant cart, the scheduling engine (hours, capacity,
preparation cutoff, walking-time "immediately after," all funneling
through one `checkPickupFeasibility()` gate), checkout preview with
stale-cart revalidation.

**Phase 3** — Razorpay, Orders & QR Pickup: real payment integration
(Razorpay Orders API, webhook + client-verify dual-path finalization with
three-layer idempotency), the order state machine (TypeScript +
mirrored DB trigger), unified-QR scan/collect with atomic
double-scan protection, QR fallback via phone search, customer order
history/detail with QR display, ratings, SMS abstraction foundation.

## Current state, in one paragraph

The customer-facing path — browse, cart, schedule, pay, receive a QR,
have it scanned, rate the order — is functionally complete in source form
and has not been run once. Vendor Admin and Staff have working
authentication and a working Scan screen; every other page in their
dashboards (and all of Super Admin beyond a placeholder) is a route stub
with no real functionality. The database schema already covers
essentially the whole platform (grievances, disbursements, analytics-
relevant tables, feature flags, etc.) so later phases build UI and
business logic against an already-complete foundation rather than
extending the schema piecemeal.

## Next tasks, in priority order

1. **Get this running.** `npm install`, fix whatever `typecheck`/`build`
   surface, apply migrations to a real Supabase project, run one real
   Razorpay test payment end-to-end. Nothing after this matters if the
   foundation doesn't actually work.
2. Work through `docs/TEST_REPORT.md`'s manual test plan and fix what it
   finds.
3. Begin Phase 4 (Vendor Admin Operations) per the SRS — the vendor
   dashboard, full order list, analytics, and staff management UI.
4. Consider addressing `docs/KNOWN_ISSUES.md` #14 (camera-based QR
   scanning) before a real pilot — text-entry scanning works but is a
   worse experience than the SRS likely intends for the common case.

## Anything a new developer must know that isn't obvious from the code

- **The commission rate is never hardcoded, anywhere.** If you find
  yourself writing `0.08` in application code outside of
  `0008_seed_platform_settings.sql`'s seed value, stop — read
  `admin_settings.commission_rate` instead, or if you're inside an
  already-created order, read `orders.commission_rate_snapshot`. This is
  a repeated, explicit SRS acceptance criterion (§23) — treat it as a
  hard rule, not a style preference.
- **`orders` has no client-writable UPDATE policy, on purpose.** If a new
  feature seems to need one, it almost certainly needs a new
  `transitionOrder()` call in a Server Action instead — see
  `docs/ARCHITECTURE.md`'s state machine section.
- **Money is paise, everywhere, no exceptions.** `lib/money.ts` is the
  only file that should ever divide by 100.
- **Every table has RLS, and the migration history proves it** — the
  project's self-review process re-verified this after every phase with a
  simple diff script (see `docs/TEST_REPORT.md`). If you add a table,
  add its RLS policies in the same migration and re-run that check
  yourself before considering the work done.
