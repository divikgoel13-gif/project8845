-- UNI8 — Phase 1 Foundation
-- 0001_extensions_and_enums.sql
--
-- Extensions and enumerated types shared across the schema.
-- Money is stored in paise (integer) throughout to avoid floating-point
-- financial errors — see SRS §17 (server is authoritative for all totals)
-- and §11.5 (commission/payable must be exact).

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";     -- case-insensitive email storage

-- Platform roles. Kept minimal and explicit — RBAC is enforced by these
-- values plus restaurant-scoped membership tables (vendor_admin_memberships,
-- restaurant_staff), never by client-submitted role claims (SRS §17).
create type app_role as enum (
  'customer',
  'vendor_admin',
  'staff',
  'super_admin'
);

create type restaurant_status as enum (
  'active',
  'paused',
  'archived'
);

create type product_availability as enum (
  'available',
  'out_of_stock'
);

create type inventory_mode as enum (
  'boolean',       -- simple available / out-of-stock (default, SRS V2 §M)
  'quantity'        -- optional quantity-based stock, vendor-enabled
);

-- Order state machine — SRS §14. Only server-side transition functions
-- (see 0006_functions_triggers.sql) may move an order between these states;
-- there is no direct client UPDATE path (enforced by RLS in 0005).
create type order_status as enum (
  'cart',
  'payment_pending',
  'paid',
  'scheduled',
  'preparing',
  'ready_for_pickup',
  'collected',
  'cancelled',
  'refund_pending',
  'refunded',
  'no_show'
);

create type payment_status as enum (
  'created',
  'authorized',
  'captured',
  'failed',
  'refunded'
);

create type pickup_mode as enum (
  'fixed_time',       -- explicit pickup time chosen by customer
  'immediately_after'  -- derived from walking-time matrix (SRS §9)
);

create type grievance_role as enum (
  'customer',
  'vendor'
);

create type grievance_category as enum (
  'payment',
  'refund',
  'wrong_item',
  'missing_item',
  'pickup',
  'qr',
  'vendor_issue',
  'staff_issue',
  'product_issue',
  'account',
  'technical',
  'other'
);

create type grievance_priority as enum (
  'low',
  'normal',
  'high',
  'urgent'
);

create type grievance_status as enum (
  'open',
  'in_review',
  'waiting_customer',
  'waiting_vendor',
  'escalated',
  'resolved',
  'closed'
);

create type disbursement_status as enum (
  'pending',
  'paid',
  'acknowledged_received',
  'acknowledged_not_received'
);
