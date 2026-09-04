# Deployment Notes

Current through Phase 8B.

## Current state: not deployed anywhere

No staging or production environment exists yet — this has only ever run
as source code in a sandboxed authoring environment with no network
access. Everything below is a plan, not a record of what was done.

## Target architecture

- **App**: Next.js 14 (App Router), deployable to any Node.js host that
  supports Next's standard build output. Vercel is the path of least
  resistance given Next.js's own tooling, but nothing here is
  Vercel-specific except the suggestion.
- **Database/Auth/Storage**: Supabase (managed Postgres + Auth + Storage).
- **Payments**: Razorpay (external, no self-hosted component).

## Required environment variables

See `.env.example` for the full, documented list. Summary by category:

| Category | Variables |
|---|---|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` |
| Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| SMS (unused until a provider is selected, SRS §Y) | `SMS_PROVIDER`, `SMS_PROVIDER_API_KEY`, `SMS_PROVIDER_SENDER_ID`, `SMS_PROVIDER_OTP_TEMPLATE_ID` |
| App | `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_APP_ENV`, `QR_FALLBACK_SIGNING_SECRET` (still unused — the fallback is phone-search, see `docs/PAYMENTS.md`), `INTERNAL_CRON_SECRET` (still unused — no scheduled job is wired up; see "Scheduled jobs" below) |

`SUPABASE_SERVICE_ROLE_KEY` and both Razorpay secrets must be server-only
environment variables (never `NEXT_PUBLIC_`-prefixed, never bundled into
client JS) — see `lib/supabase/server.ts` and `lib/payments/razorpay.ts`'s
doc comments for why this matters.

## Deployment steps (first deploy)

1. Create the Supabase project. Run `supabase link` then
   `npm run db:migrate` to apply all 22 migrations in
   `supabase/migrations/` in order. Order matters: `0016` adds the Phase 7–9
   schema, `0017` its RLS, `0020` adds V2.6 enum values that `0021` then
   depends on.
2. Storage buckets need no manual step any more — `0013` creates
   `product-images` and `restaurant-branding` (public), `0015` creates
   `payout-proofs` and `0018` creates `grievance-attachments` (both private,
   with path-scoped policies). After migrating, verify in the dashboard that
   the two private buckets really are private; a bucket that silently ends up
   public defeats the whole signed-URL design.
3. Confirm the seeded platform rows landed: `0008` seeds `admin_settings`
   (commission rate, cancellation penalty), and `0022` seeds the
   `grievance_opened` / `grievance_replied` in-app notification templates.
   Both are `on conflict do nothing`, so re-running is safe and will not
   clobber an operator's edited copy.
4. Set every environment variable from `.env.example` in the hosting
   platform's environment configuration — never commit a filled `.env`
   file.
5. Deploy the Next.js app (`npm run build && npm run start`, or the
   platform's native Next.js build pipeline).
6. In the Razorpay Dashboard (test mode first): Settings → Webhooks → add
   `https://<deployed-domain>/api/webhooks/razorpay`, subscribed to at
   least `payment.captured` and `payment.failed`. Copy the webhook secret
   into `RAZORPAY_WEBHOOK_SECRET`.
7. Create the first Super Admin. There is no self-service path to that role by
   design — use `scripts/seed-auth-users.ts` as the pattern, or create the auth
   user and then set `profiles.role` with the service-role key once.
8. Run through `docs/TEST_REPORT.md`'s manual test plan against the
   deployed environment before considering this "working." Expect
   `npm run typecheck` and `npm run build` to surface real errors on the first
   run — no compiler has ever seen this code.

## Scheduled jobs (none wired up yet)

`INTERNAL_CRON_SECRET` exists in `.env.example` for these, but no cron
mechanism has been chosen and no endpoint consumes it. Three jobs are specified
and unbuilt (see `docs/KNOWN_ISSUES.md` #17, #21 and the abandoned-checkout
item):

- **Abandoned-checkout cleanup** — cancel `payment_pending` orders older than
  the payment window so they stop occupying capacity accounting.
- **Orphaned attachment sweep** — list objects under `ticket/` older than 24 h,
  left-join `grievance_attachments.storage_path`, delete the misses. The path's
  second segment is the ticket uuid, so the join is exact. Needed because the
  browser uploads before the binding row is written.
- **SLA / overdue recomputation and digest notifications** — currently derived
  at read time, which is correct but means nothing notifies anyone off-hours.

Whichever mechanism is chosen (Vercel Cron, Supabase pg_cron, an external
scheduler), all three should share it and authenticate with
`INTERNAL_CRON_SECRET` rather than being publicly reachable.

## Operating maintenance mode (V2.6 §R)

Maintenance state lives in the database (`lib/platform/maintenance.ts`), not in
an env var, so toggling it does not require a redeploy. It is enforced by
`assertNotInMaintenance()` inside write actions rather than by a route gate,
because §R requires existing paid orders to stay reachable — and a gate over the
admin tree would lock the operator away from the switch that turns it off. The
operator UI for the switch is Phase 9B; until then it is a row update.

## Rollback

No deployment has happened yet, so there is no rollback history. Once
real deployments begin: Supabase migrations are additive/ordered
(`0001`…`0022` so far) — rolling back a bad migration means writing a
new migration that reverses it, not editing or deleting a past one (matches
the project's "handover ZIP is versioned and dated, never rewrite
history" principle, SRS §24). Note that enum values cannot be dropped at all,
which is why `0020` is additive-only.

## Monitoring / observability

Not yet built. `audit_logs` and `payment_events` serve as the de facto
operational log (queryable via Supabase's SQL editor), and `/admin/operations`
is the closest thing to a live dashboard — but there is no alerting, no
error-tracking integration (Sentry or similar), and no rate limiting on OTP,
login, QR-scan or support endpoints. All flagged in `docs/KNOWN_ISSUES.md` for
Phase 9/10 rather than silently assumed to exist.
