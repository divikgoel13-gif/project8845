-- UNI8 — Phase 1 Foundation
-- 0004_support_and_platform_tables.sql
--
-- Central grievance CRM, ratings, notifications, audit log, and the
-- Super-Admin-controlled platform configuration table that the commission
-- rate (and other configurable values) live in. SRS §7, §13, §17, §11.5.

-- ─────────────────────────────────────────────────────────────────────────
-- Central grievance CRM (SRS §13) — customer AND vendor tickets, always
-- owned by UNI8 Super Admin/support. Never routed to a Vendor Admin.
-- ─────────────────────────────────────────────────────────────────────────
create table grievance_tickets (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles (id),
  requester_role grievance_role not null,
  restaurant_id uuid references restaurants (id),
  order_id uuid references orders (id),
  category grievance_category not null,
  priority grievance_priority not null default 'normal',
  status grievance_status not null default 'open',
  assignee_id uuid references profiles (id),          -- must be a super_admin (enforced in RLS/app layer)
  resolution_category text,
  resolution_note text,                                 -- mandatory before status can become 'resolved'
  first_response_at timestamptz,
  resolved_at timestamptz,
  reopened_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table refund_events
  add constraint refund_events_grievance_ticket_fk
  foreign key (grievance_ticket_id) references grievance_tickets (id);

alter table disbursements
  add constraint disbursements_escalation_ticket_fk
  foreign key (not_received_escalated_ticket_id) references grievance_tickets (id);

create table grievance_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references grievance_tickets (id) on delete cascade,
  sender_id uuid not null references profiles (id),
  body text not null,
  is_internal boolean not null default false,   -- admin-only internal note vs requester-visible message
  created_at timestamptz not null default now()
);

create table grievance_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references grievance_tickets (id) on delete cascade,
  message_id uuid references grievance_messages (id) on delete cascade,
  storage_path text not null,       -- private bucket
  uploaded_by uuid not null references profiles (id),
  created_at timestamptz not null default now()
);

-- Immutable timeline: status/assignment/note/attachment/refund events (SRS §13).
create table grievance_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references grievance_tickets (id) on delete cascade,
  event_type text not null,          -- e.g. 'status_changed', 'assigned', 'reopened', 'escalated'
  actor_id uuid references profiles (id),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- Ratings (SRS §7, §9)
-- ─────────────────────────────────────────────────────────────────────────
create table ratings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders (id) on delete cascade,
  customer_id uuid not null references profiles (id),
  restaurant_id uuid not null references restaurants (id),
  stars smallint not null check (stars between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- Notifications (SMS today; channel-abstracted per SRS V2 §E)
-- ─────────────────────────────────────────────────────────────────────────
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id),
  channel text not null default 'sms',
  template text not null,           -- e.g. 'order_ready', 'otp', 'pickup_reminder'
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'failed')),
  provider_message_id text,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- Audit log — every privileged action (SRS §2, §17). Written by the
-- server-side helper in lib/audit, never client-writable (see RLS in 0005).
-- ─────────────────────────────────────────────────────────────────────────
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles (id),
  actor_role app_role,
  action text not null,                 -- e.g. 'commission_rate.updated', 'staff.disabled'
  target_table text,
  target_id uuid,
  restaurant_id uuid references restaurants (id),  -- denormalized for restaurant-scoped audit views
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index idx_audit_logs_target on audit_logs (target_table, target_id);
create index idx_audit_logs_restaurant on audit_logs (restaurant_id);
create index idx_audit_logs_created_at on audit_logs (created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- Platform configuration — Super-Admin-controlled, never hardcoded
-- (SRS §1.2, §11.5, §23). Includes commission rate, cancellation penalty
-- rate, feature flags, maintenance mode.
-- ─────────────────────────────────────────────────────────────────────────
create table admin_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);

create table feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text,
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);

create table announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  scope text not null default 'global' check (scope in ('global', 'restaurant')),
  restaurant_id uuid references restaurants (id),
  starts_at timestamptz,
  ends_at timestamptz,
  is_published boolean not null default false,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create table maintenance_mode (
  key text primary key default 'global',   -- 'global' or a module name
  is_active boolean not null default false,
  message text,
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);

create table fraud_flags (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('customer', 'vendor', 'qr')),
  subject_id uuid not null,
  signal text not null,             -- e.g. 'excessive_otp_requests', 'repeated_failed_scan'
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'investigating', 'resolved', 'dismissed')),
  reviewed_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
