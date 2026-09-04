# Test Report — Phases 1–8 (current through Phase 8B)

## Status: NO code in this repository has ever been executed

This sandbox cannot reach the npm registry (E403), so there is no
`node_modules` and therefore no `npm install`, no `next build`, no
`tsc --noEmit`, no `next lint`, no `supabase gen types`, no live Supabase
project and no Razorpay connection. Every correctness claim in this repository
comes from static analysis and manual reasoning, not from running anything —
`docs/KNOWN_ISSUES.md` #1 is the master tracker for this gap.

**This remains the single most important item in the handover.** Nothing should
be treated as production-ready until someone with a real environment has run
`npm install && npm run typecheck && npm run build` and worked through the
checklist at the end of this file.

## How the code is actually verified: `scripts/verify-static.mjs`

A dependency-free Node script (no imports outside `node:*`, so it runs with
nothing installed). Five independent checks:

| Check | What it proves |
|---|---|
| `imports` | every `@/`-aliased and relative import resolves to a real file, and every *named* import exists as an export in that file |
| `schema` | every table, column and enum value referenced in code exists in `supabase/migrations/` |
| `routes` | every `Link href` / `redirect()` target resolves to a route file |
| `balance` | brace/paren/bracket and JSX-tag balance per file — the class of error that is otherwise invisible without a compiler |
| `boundaries` | `"use client"` files do not import `server-only` modules; service-role client usage is preceded by a guard; `"use server"` files export only async functions |

Run it with:

```bash
node scripts/verify-static.mjs                                   # everything
node scripts/verify-static.mjs --only=imports,routes,balance,boundaries
```

## Current results (2026-08-30, Phase 8B complete)

```
imports:    PASS  — 197 source files scanned
routes:     FAIL  — 21 problems, all known/expected (see below)
balance:    FAIL  — 16 problems, all false positives (see below)
boundaries: FAIL  — 32 problems, all false positives (see below)
schema:     not run — the parser produces ~210 false positives; see KNOWN_ISSUES
```

`imports` is the check that has actual teeth, and it is green. The other three
fail for reasons that are understood file-by-file. **Do not "fix" the code to
silence them** — fix the verifier, or build the missing Phase 9 routes.

### Why `routes` fails (21)

- **15 × `href "/admin/restaurants/$"`** — the scanner truncates template
  literals, so `` `/admin/restaurants/${id}/dashboard` `` is reported as a
  literal `/admin/restaurants/$`. The routes are real.
- **5 × the unbuilt Phase 9 destinations** — `/admin/analytics`,
  `/admin/settings` (×3 call sites), `/admin/audit/fraud`. The §5.1 navigation
  is deliberately complete before the pages exist; see `docs/PHASE_STATUS.md`
  Phase 7 "What Phase 7 does not include".
- **1 × `redirect("/")`** in `app/auth/customer/onboarding/actions.ts` —
  `app/page.tsx` exists at the app root; the scanner only looks inside route
  groups.

### Why `balance` fails (16)

Every one is a generic type parameter being read as an unclosed JSX tag:
`<T>`, `<HTMLDivElement>`, `<string>`, `<BadgeTone>`, `<RestaurantStatus>`,
`<TimelineEvent>`, `<RestaurantOperationsSettings>`. Plus
`scripts/verify-static.mjs` reporting its own brace depth, which is an artifact
of it scanning itself.

### Why `boundaries` fails (32)

Two false-positive families:

- **9 client components "importing a server-only module"** — all nine use
  `import type`, which TypeScript erases at build time, so nothing
  `server-only` is actually in the client bundle. The scanner does not
  distinguish `import type` from `import`.
- **23 "service-role client with no guard"** — split three ways. Some are
  `server-only` data/infrastructure modules that are *called by* guarded
  actions and correctly have no guard of their own (`lib/audit/log.ts`,
  `lib/orders/state-machine.ts`, `lib/scheduling/*`, `lib/platform/*`,
  `lib/notifications/*`). Some are vendor actions that guard via
  `requireRestaurantScope()`, which the regex does match — but in a helper
  above the call site. And `lib/actions/customer/grievance.ts` is flagged
  purely because the guard alternation omits `requireProfile`; that is
  `docs/KNOWN_ISSUES.md` #22 and the fix is one word in the verifier.

The genuinely useful signal from this check has already been acted on: it is
how the `import type` discipline and the guard-before-service-role rule were
confirmed across all 197 files in the first place.

## What has NOT been done

- No automated test suite exists (`vitest`/`jest` were never installable).
- No RLS policy has been tested against a real Postgres instance with real
  JWTs per role. The static RLS coverage diff (every `create table` has a
  matching `enable` **and** `force row level security`) passes, but coverage is
  not correctness.
- No Razorpay test-mode payment completed; no webhook actually delivered.
- The `qrcode` package has never been installed or run.
- No concurrency testing of the pickup-capacity race (`KNOWN_ISSUES` #8) or of
  the QR double-scan path.
- No file has ever actually been uploaded to `grievance-attachments`, so
  migration 0018's Storage policies are unexercised. This is the highest-value
  thing to test first in a real environment, because the whole attachment
  design leans on them being right.

## Manual test plan for the next environment with real access

### Setup
1. `npm install`, `npm run typecheck`, `npm run build` — fix whatever surfaces
   before anything else. Expect real errors here; 197 files have never met a
   compiler.
2. Apply all 22 migrations to a fresh Supabase project (`npm run db:migrate`).
3. Seed dev data (`npm run db:seed`) and test accounts
   (`npx tsx scripts/seed-auth-users.ts`).
4. Confirm RLS is enabled **and forced** for every table in the dashboard, and
   that all four Storage buckets exist with `grievance-attachments` and
   `payout-proofs` private.

### Auth (Phase 1)
- [ ] Customer phone+OTP sign-in and first-time onboarding
- [ ] Vendor Admin / Staff / Super Admin email+password sign-in
- [ ] A vendor_admin visiting `/admin/dashboard` is redirected, not shown content
- [ ] A raw Supabase client call attempting a role/status change is rejected by
      `trg_prevent_self_role_escalation`
- [ ] `force_logout_user()` is not executable as `authenticated`

### Discovery, cart, scheduling (Phase 2)
- [ ] Browse restaurants unauthenticated; menu pages load
- [ ] Add items from two different restaurants to cart
- [ ] Schedule pickup: first restaurant fixed time, second "immediately after" —
      confirm the computed time is exactly walking_time + first pickup time
- [ ] Pickup time outside restaurant hours → rejected with a clear reason
- [ ] Overfill a slot (seed capacity 1, create two orders) → second rejected
- [ ] Pause a restaurant mid-session; cart/checkout reflects it

### Payments, orders, QR (Phase 3)
- [ ] Full checkout → Razorpay test payment → webhook → order shows
      `paid`/`scheduled` in the customer's history
- [ ] Disable the webhook, pay, confirm the client-verify path alone confirms
      the order; re-enable and confirm the later delivery is a no-op (exactly
      one `payment_events` row)
- [ ] Replay the same webhook event-id twice — no duplicate order or
      `vendor_payables` rows
- [ ] Scan the same QR twice at the same restaurant in two tabs — exactly one
      collects, the other gets "already collected"
- [ ] Scan at the wrong restaurant → rejected
- [ ] QR fallback by phone → collection succeeds and an `audit_logs` row with
      the reason exists
- [ ] Rate a `collected` order; a second rating attempt is rejected

### Vendor and staff surfaces (Phases 4–6)
- [ ] Vendor order queue advances an order through every legal transition and
      refuses an illegal one (the Postgres trigger must reject it too, not just
      the TypeScript table)
- [ ] Product create/edit with an image upload lands in `product-images` under
      `restaurant/<id>/…`
- [ ] Vendor creates staff, deactivates them, and confirms the deactivated
      staff member's existing session stops working within the access-token TTL
- [ ] Credential reset forces the same logout
- [ ] Vendor A cannot open any `/vendor/...` page scoped to Restaurant B, by URL
- [ ] Disbursement recorded by Super Admin appears in the vendor's payout view
      with the same paise figure — no rounding drift anywhere

### Super Admin command center (Phase 7)
- [ ] `/admin/dashboard` totals reconcile against hand-summed `orders` for the
      same day — especially commission, which must equal the sum of per-order
      `commission_amount_paise` snapshots, **not** today's rate × today's revenue
- [ ] Change the commission rate, then reload the dashboard: historical figures
      must not move
- [ ] `/admin/operations` raises each of the eleven §F alert classes at least
      once (seed the conditions); acknowledging one keeps it visible and dimmed
- [ ] `/admin/orders` filters work with JavaScript disabled, and a filtered URL
      is shareable
- [ ] Create a restaurant, move it through all four §60 states, archive it —
      confirm it disappears from the default directory view and that no
      `delete from restaurants` exists anywhere
- [ ] Open all fourteen workspace tabs for one restaurant; none 500s, and each
      shows that restaurant's data only
- [ ] Enable maintenance mode: write actions refuse, but an existing paid order
      is still viewable and the admin can still turn maintenance off

### Customer 360 and grievance CRM (Phase 8)
- [ ] `/admin/customers` search, then open a Customer 360: order history,
      spend, flags, notes and tickets all belong to that customer
- [ ] Add and clear a customer flag; suspend and reinstate an account — every
      one produces an `audit_logs` row
- [ ] A suspended customer cannot place an order
- [ ] Customer raises a ticket from an order via "Need help with this order?";
      no order id or restaurant is typed, and the ticket links to both
- [ ] A second ticket on the same order is refused, and the UI points at the
      existing one
- [ ] The §59 "still waiting" prompt appears only for a `ready_for_pickup`,
      uncollected order past the threshold
- [ ] Support replies → customer sees an in-app notification whose title/body
      came from `notification_templates`; edit the template and confirm the
      already-sent notification does not change
- [ ] Internal notes are invisible to the customer (check the raw response, not
      just the rendering)
- [ ] **Attachments:** customer uploads a photo on their own open ticket
      (succeeds); on a resolved ticket (blocked, and no picker is offered);
      into another ticket's path via a crafted call (blocked by Storage RLS,
      and `parseAttachmentPaths` throws before any row is written); a vendor
      admin attempts to read an attachment on their own restaurant's ticket
      (blocked)
- [ ] A signed attachment URL stops working after five minutes
- [ ] Resolve a ticket without a category or note → refused; reopen it →
      timeline shows both events and nothing was overwritten
- [ ] Grievance CSV export contains no message bodies

### Security spot-checks (full audit is Phase 10, but these are cheap)
- [ ] Read another customer's `orders`/`payments` with the anon key and a
      different user's JWT → nothing returned
- [ ] Direct `UPDATE orders SET status = 'collected'` with the anon key →
      rejected (no client UPDATE policy exists)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` never appears in browser-bundled JS
      (`grep -r` the `.next` output)
- [ ] No `server-only` module ends up in a client chunk
- [ ] A customer cannot reach any `/admin/*` route, including the
      `export/route.ts` handlers by direct URL



