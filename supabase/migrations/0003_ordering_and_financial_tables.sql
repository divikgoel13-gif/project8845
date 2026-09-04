-- UNI8 — Phase 1 Foundation
-- 0003_ordering_and_financial_tables.sql
--
-- Cart → checkout → order → payment → payable → disbursement chain.
-- Full behavior (scheduling, QR, Razorpay integration) is built out in
-- Phases 2–3; this migration establishes the durable schema and financial
-- integrity constraints those phases build on, per SRS §16 and §11.5.

-- ─────────────────────────────────────────────────────────────────────────
-- Cart (pre-checkout, ephemeral in practice but persisted for resilience)
-- ─────────────────────────────────────────────────────────────────────────
create table carts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references carts (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- Multi-restaurant checkout grouping + pickup sequencing (SRS §9, V2 §J)
-- ─────────────────────────────────────────────────────────────────────────
create table multi_order_groups (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles (id) on delete cascade,
  -- One customer-facing QR per group, shared across that group's restaurant
  -- orders (SRS V2 §J). Opaque, non-guessable token — resolved server-side only.
  qr_token text not null unique default encode(gen_random_bytes(24), 'base64url'),
  created_at timestamptz not null default now()
);

create table pickup_sequences (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references multi_order_groups (id) on delete cascade,
  restaurant_id uuid not null references restaurants (id) on delete restrict,
  sequence_no integer not null,
  mode pickup_mode not null,
  pickup_time timestamptz not null,  -- always resolved to an absolute server time,
                                       -- even when selected as "immediately after"
  created_at timestamptz not null default now(),
  unique (group_id, sequence_no)
);

-- ─────────────────────────────────────────────────────────────────────────
-- Orders — one row per restaurant order (a multi-restaurant checkout
-- produces multiple order rows sharing one multi_order_groups.id).
-- ─────────────────────────────────────────────────────────────────────────
create table orders (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references multi_order_groups (id) on delete restrict,
  customer_id uuid not null references profiles (id) on delete restrict,
  restaurant_id uuid not null references restaurants (id) on delete restrict,
  status order_status not null default 'cart',

  subtotal_paise integer not null check (subtotal_paise >= 0),

  -- Commission is SNAPSHOTTED at the moment the financial obligation is
  -- created and must never be recalculated from admin_settings later
  -- (SRS §11.5, §23 acceptance criteria: "Changing the commission setting
  -- does not retroactively alter historical orders").
  commission_rate_snapshot numeric(6, 4),        -- e.g. 0.0800 for 8%
  commission_amount_paise integer,
  vendor_payable_paise integer,

  pickup_time timestamptz,
  ready_at timestamptz,
  ready_source text check (ready_source in ('manual', 'auto')),  -- SRS V2 §B.2
  collected_at timestamptz,

  cancelled_at timestamptz,
  cancelled_by uuid references profiles (id),
  cancel_reason text,
  cancel_penalty_rate numeric(6, 4),             -- SRS V2 §C.2 — 49% at launch, configurable
  cancel_penalty_amount_paise integer,

  no_show_at timestamptz,

  -- Per-restaurant QR resolution: the customer-facing QR lives on
  -- multi_order_groups (or is generated 1:1 for single-restaurant orders);
  -- this token is what a restaurant's scanner actually authorizes against,
  -- scoped so Restaurant A can never resolve Restaurant B's order (SRS V2 §J).
  scan_token text not null unique default encode(gen_random_bytes(24), 'base64url'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_orders_customer on orders (customer_id);
create index idx_orders_restaurant on orders (restaurant_id);
create index idx_orders_status on orders (status);
create index idx_orders_pickup_time on orders (pickup_time);
create index idx_orders_restaurant_pickup_status on orders (restaurant_id, pickup_time, status);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  product_id uuid references products (id) on delete set null,
  -- Immutable purchase-time snapshot — survives later product edits/archival
  -- (SRS §1.1: "Historical financial/order records must remain auditable
  -- even when restaurants/products/staff are archived").
  name_snapshot text not null,
  price_snapshot_paise integer not null check (price_snapshot_paise >= 0),
  quantity integer not null check (quantity > 0)
);

-- ─────────────────────────────────────────────────────────────────────────
-- Payments (Razorpay) — server/webhook authoritative, never client-reported.
-- ─────────────────────────────────────────────────────────────────────────
create table payments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references multi_order_groups (id) on delete restrict,
  customer_id uuid not null references profiles (id) on delete restrict,
  razorpay_order_id text unique,
  razorpay_payment_id text unique,
  amount_paise integer not null check (amount_paise >= 0),
  status payment_status not null default 'created',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Immutable event history for idempotent webhook processing (SRS §12, §17).
create table payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references payments (id) on delete cascade,
  -- Razorpay's event id, used as the idempotency key so a redelivered
  -- webhook can never be double-applied.
  provider_event_id text not null unique,
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table refund_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete restrict,
  payment_id uuid references payments (id),
  requested_by uuid references profiles (id),        -- customer, via grievance
  decided_by uuid references profiles (id),           -- super admin
  grievance_ticket_id uuid,                            -- fk added in 0004 (grievance_tickets defined there)
  amount_paise integer not null check (amount_paise >= 0),
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'rejected', 'initiated', 'succeeded', 'failed')),
  razorpay_refund_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- Vendor payable + manual disbursement (SRS §12, V2 §D.2)
-- ─────────────────────────────────────────────────────────────────────────
create table vendor_payables (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders (id) on delete restrict,
  restaurant_id uuid not null references restaurants (id) on delete restrict,
  amount_paise integer not null check (amount_paise >= 0),
  disbursed_amount_paise integer not null default 0 check (disbursed_amount_paise >= 0),
  created_at timestamptz not null default now(),
  check (disbursed_amount_paise <= amount_paise)
);

create table disbursements (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete restrict,
  admin_id uuid not null references profiles (id),
  amount_paise integer not null check (amount_paise > 0),
  -- Which vendor_payables rows this payout covers, and how much of each —
  -- supports partial payouts across multiple orders (SRS §12).
  covers jsonb not null default '[]'::jsonb,
  proof_path text not null,                 -- private Supabase Storage bucket
  status disbursement_status not null default 'pending',
  reference text,
  acknowledged_at timestamptz,
  not_received_escalated_ticket_id uuid,     -- fk added in 0004
  created_at timestamptz not null default now()
);

-- Restaurant-cancellation penalty ledger — separate from the original sale/
-- commission record (SRS V2 §C.2: "must not overwrite the original sale").
create table restaurant_cancellation_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete restrict,
  restaurant_id uuid not null references restaurants (id) on delete restrict,
  actor_id uuid not null references profiles (id),
  reason text not null,
  penalty_rate numeric(6, 4) not null,        -- snapshot of admin_settings 'restaurant_cancellation_penalty_rate'
  penalty_amount_paise integer not null check (penalty_amount_paise >= 0),
  created_at timestamptz not null default now()
);

create index idx_vendor_payables_restaurant on vendor_payables (restaurant_id);
create index idx_disbursements_restaurant on disbursements (restaurant_id);
