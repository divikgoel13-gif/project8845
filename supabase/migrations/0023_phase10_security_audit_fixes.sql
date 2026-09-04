-- UNI8 — Phase 10 Security Audit fixes
-- 0023_phase10_security_audit_fixes.sql
--
-- Addresses PHASE_10_SECURITY_AUDIT.md net defect list items 1, 2, 4, 5, 8.
-- (Item 3, the automated test suite, and item 6, the rate-limiting posture
-- decision, are not schema changes and are tracked separately. Item 7,
-- the verify-static.mjs regex bugs, is a script fix, not a migration.)

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Drop the `disbursements_ack_vendor` RLS UPDATE policy (§10.7/§10.12).
--
-- This policy correctly scoped which ROW a vendor admin could touch
-- (their own restaurant's disbursement) but RLS has no column-level
-- granularity, so it left every column — amount_paise, covers, proof_path,
-- reference — open to a direct, modified-payload REST call, not just the
-- intended acknowledgement fields. The app never actually relies on this
-- policy: lib/actions/vendor/acknowledge-payout.ts performs its updates
-- through the service-role client after its own requireRestaurantScope
-- check. Dropping it brings `disbursements` in line with every other
-- financial table (payments, payment_events, refund_events,
-- vendor_payables), all of which are select-only for client roles.
drop policy if exists "disbursements_ack_vendor" on disbursements;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. `restaurant_staff` / `vendor_admin_memberships`: replace the blanket
-- UNIQUE(user_id, restaurant_id) with a partial unique index scoped to
-- disabled_at IS NULL (§10.5).
--
-- The blanket constraint blocked re-hiring: disabling a staff/vendor-admin
-- membership left a row behind, and adding the same person back to the
-- same restaurant later hit the unique violation. Only ACTIVE memberships
-- need to be unique — a person can accumulate any number of disabled
-- historical memberships to the same restaurant.
alter table vendor_admin_memberships
  drop constraint if exists vendor_admin_memberships_user_id_restaurant_id_key;

create unique index vendor_admin_memberships_active_unique
  on vendor_admin_memberships (user_id, restaurant_id)
  where disabled_at is null;

alter table restaurant_staff
  drop constraint if exists restaurant_staff_user_id_restaurant_id_key;

create unique index restaurant_staff_active_unique
  on restaurant_staff (user_id, restaurant_id)
  where disabled_at is null;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. `notifications`: add a dedup key (§10.11).
--
-- lib/notifications/send.ts inserted unconditionally on every call with no
-- constraint to stop a duplicate. Currently masked because its only
-- caller (finalizePayment) is itself idempotent before ever reaching it,
-- but the notification layer had no independent guarantee. dedupe_key is
-- nullable so ad hoc/one-off notifications (nothing meaningful to key on)
-- are unaffected; callers that represent a specific, at-most-once business
-- event (e.g. "order_paid for order <id>") pass one and get a DB-enforced
-- guarantee instead of relying on every future caller being idempotent on
-- its own.
alter table notifications add column if not exists dedupe_key text;

create unique index if not exists notifications_dedupe_key_unique
  on notifications (dedupe_key)
  where dedupe_key is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. `cart_items`: add uniqueness on (cart_id, product_id) (§10.5).
--
-- Without this, concurrent "add to cart" calls for the same product could
-- both pass the read-then-write "does a line item already exist" check in
-- lib/actions/customer/cart.ts and each insert a separate line item for
-- the same product, splitting one product across two cart rows.
alter table cart_items
  add constraint cart_items_cart_id_product_id_key unique (cart_id, product_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 8. Formally close the Supabase advisor WARNs on the SECURITY DEFINER RLS
-- helper functions by revoking EXECUTE from `anon` (§ Net defect list, 8).
--
-- These five functions were already confirmed safe — every one of them
-- reads only via auth.uid(), which is null for anon, so an anon caller
-- gets an empty/false result either way. This is not closing an
-- exploitable gap; it's removing needless advisor noise (an unauthenticated
-- caller should never have had EXECUTE in the first place) so the advisor
-- output stays trustworthy for the findings that do matter.
revoke execute on function current_app_role() from anon;
revoke execute on function is_super_admin() from anon;
revoke execute on function is_active_vendor_admin_for(uuid) from anon;
revoke execute on function is_active_staff_for(uuid) from anon;
revoke execute on function my_restaurant_ids() from anon;
