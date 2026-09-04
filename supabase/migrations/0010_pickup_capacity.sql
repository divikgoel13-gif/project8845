-- UNI8 — Phase 2 (Customer Discovery, Cart & Scheduling)
-- 0010_pickup_capacity.sql
--
-- Adds the pickup-slot capacity model referenced but not yet schema'd in
-- Phase 1 (SRS §2: "Pickup-slot capacity — Prevent a restaurant from
-- accepting more orders in a pickup window than it can handle" and
-- "Preparation cutoff — Prevent last-minute orders for slots that can no
-- longer be prepared reliably").
--
-- Design: pickup time is bucketed into fixed-width slots
-- (restaurants.pickup_slot_interval_minutes, default 15). Each bucket has a
-- capacity — restaurants.default_slot_capacity unless overridden for a
-- specific weekday or specific date in pickup_capacity_overrides. Remaining
-- capacity for a bucket is computed on read as
-- (capacity - count of non-cancelled/non-refunded/non-no_show orders whose
-- pickup_time falls in that bucket) — see lib/scheduling/capacity.ts.
--
-- Preparation cutoff is handled without a separate column: an order is
-- only feasible if pickup_time >= now() + restaurants.preparation_default_minutes
-- (already defined in Phase 1). See lib/scheduling/feasibility.ts.

alter table restaurants
  add column pickup_slot_interval_minutes integer not null default 15
    check (pickup_slot_interval_minutes > 0),
  add column default_slot_capacity integer not null default 8
    check (default_slot_capacity > 0);

comment on column restaurants.pickup_slot_interval_minutes is
  'Width, in minutes, of one pickup capacity bucket. E.g. 15 means pickup '
  'times are grouped into :00/:15/:30/:45 buckets for capacity purposes.';
comment on column restaurants.default_slot_capacity is
  'Default max orders per pickup bucket, overridable per weekday or date '
  'via pickup_capacity_overrides.';

create table pickup_capacity_overrides (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  -- Exactly one of day_of_week (recurring) or specific_date (one-off) must
  -- be set — mirrors the recurring-hours vs exception-hours split already
  -- used by restaurant_hours / restaurant_hour_exceptions.
  day_of_week smallint check (day_of_week between 0 and 6),
  specific_date date,
  slot_start time not null,
  capacity integer not null check (capacity >= 0), -- 0 = fully blocked slot
  created_at timestamptz not null default now(),
  check (
    (day_of_week is not null and specific_date is null)
    or (day_of_week is null and specific_date is not null)
  )
);

create unique index uq_capacity_override_recurring
  on pickup_capacity_overrides (restaurant_id, day_of_week, slot_start)
  where day_of_week is not null;

create unique index uq_capacity_override_specific
  on pickup_capacity_overrides (restaurant_id, specific_date, slot_start)
  where specific_date is not null;

alter table pickup_capacity_overrides enable row level security;
alter table pickup_capacity_overrides force row level security;

create policy "capacity_overrides_select_all" on pickup_capacity_overrides
  for select using (true);

create policy "capacity_overrides_write_scoped" on pickup_capacity_overrides
  for all using (is_super_admin() or is_active_vendor_admin_for(restaurant_id))
  with check (is_super_admin() or is_active_vendor_admin_for(restaurant_id));

-- Index to make "count orders in this restaurant's pickup bucket" cheap —
-- complements idx_orders_restaurant_pickup_status from Phase 1.
create index idx_orders_restaurant_pickup_time_active on orders (restaurant_id, pickup_time)
  where status not in ('cancelled', 'refunded', 'no_show');
