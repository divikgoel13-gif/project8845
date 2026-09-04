-- UNI8 — Phase 1 Foundation
-- 0002_core_tables.sql
--
-- Identity, restaurant-scoped access, and product catalog tables.
-- SRS §4 (Roles & Access Model), §9 (customer onboarding), §16 (core entities).

-- ─────────────────────────────────────────────────────────────────────────
-- profiles: one row per authenticated person (customer, vendor admin, staff,
-- or super admin). id mirrors auth.users.id 1:1. `role` is the person's
-- PRIMARY role for routing/UX purposes only — it is never the sole
-- authorization check for restaurant-scoped actions; vendor_admin_memberships
-- and restaurant_staff are the actual scope grants (SRS §17: authorization
-- must be server-side and explicit, not inferred from a single flag).
-- ─────────────────────────────────────────────────────────────────────────
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role app_role not null default 'customer',
  phone text unique,               -- customer auth channel (SRS §9: phone + OTP)
  email citext unique,             -- vendor/staff/admin auth channel + customer optional
  name text,
  course text,                     -- customer onboarding field (SRS §1.1) — no block/hostel in V1
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table profiles is
  'One row per person across all four roles. Role-specific scope lives in '
  'vendor_admin_memberships / restaurant_staff, not here.';
comment on column profiles.course is
  'Collected at first customer login per SRS §1.1. Do not add block/hostel in V1.';

-- ─────────────────────────────────────────────────────────────────────────
-- restaurants
-- ─────────────────────────────────────────────────────────────────────────
create table restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status restaurant_status not null default 'active',
  description text,
  location text,
  logo_path text,                       -- Supabase Storage path (public bucket)
  paused_until timestamptz,             -- SRS V2 §G: temporary pause, timed or manual
  paused_reason text,
  preparation_default_minutes integer not null default 10,
  grace_period_minutes integer not null default 15,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table restaurant_hours (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6), -- 0 = Sunday
  opens_at time,
  closes_at time,
  is_closed boolean not null default false,
  unique (restaurant_id, day_of_week)
);

create table restaurant_hour_exceptions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  exception_date date not null,
  is_closed boolean not null default true,
  opens_at time,
  closes_at time,
  note text,
  unique (restaurant_id, exception_date)
);

-- Backend-configured walking time between restaurant pairs (SRS §2, §9).
-- Stored directionally; a lookup helper should treat (a,b) and (b,a)
-- as independent so asymmetric campus geography can be modeled if needed,
-- but a symmetric default may be assumed when only one row exists.
create table walking_times (
  id uuid primary key default gen_random_uuid(),
  restaurant_from_id uuid not null references restaurants (id) on delete cascade,
  restaurant_to_id uuid not null references restaurants (id) on delete cascade,
  minutes integer not null check (minutes >= 0),
  updated_at timestamptz not null default now(),
  check (restaurant_from_id <> restaurant_to_id),
  unique (restaurant_from_id, restaurant_to_id)
);

-- ─────────────────────────────────────────────────────────────────────────
-- Restaurant-scoped access grants — the actual authorization source of
-- truth for vendor_admin / staff actions (SRS §4, §8).
-- ─────────────────────────────────────────────────────────────────────────
create table vendor_admin_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  created_at timestamptz not null default now(),
  disabled_at timestamptz,
  unique (user_id, restaurant_id)
);

create table restaurant_staff (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  created_at timestamptz not null default now(),
  disabled_at timestamptz,
  unique (user_id, restaurant_id)
);

comment on table restaurant_staff is
  'Max 5 ACTIVE (disabled_at is null) staff per restaurant — enforced by '
  'trigger enforce_staff_limit in 0006_functions_triggers.sql, per SRS §11.';

-- ─────────────────────────────────────────────────────────────────────────
-- Product catalog
-- ─────────────────────────────────────────────────────────────────────────
create table product_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  category_id uuid references product_categories (id) on delete set null,
  name text not null,
  description text,
  price_paise integer not null check (price_paise >= 0),  -- price is required (SRS §10)
  image_path text,                                          -- optional (SRS §10)
  cook_time_minutes integer,                                -- optional (SRS §10)
  availability product_availability not null default 'available',
  inventory_mode inventory_mode not null default 'boolean', -- SRS V2 §M
  stock_quantity integer,                                   -- only meaningful when inventory_mode = 'quantity'
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  check (
    (inventory_mode = 'boolean' and stock_quantity is null)
    or (inventory_mode = 'quantity')
  )
);

create index idx_products_restaurant on products (restaurant_id) where archived_at is null;
create index idx_restaurant_staff_active on restaurant_staff (restaurant_id) where disabled_at is null;
create index idx_vendor_admin_active on vendor_admin_memberships (restaurant_id) where disabled_at is null;
