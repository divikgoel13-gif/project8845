-- UNI8 — Developer 3, Phases 7-9 (Super Admin Command Center, CRM, Platform Completion)
-- 0016_phase7_9_schema.sql
--
-- Phase 1 deliberately front-loaded most of the downstream schema (see
-- docs/PHASE_STATUS.md Phase 1: "covers ... the full downstream operational
-- schema ... so Phases 2-9 aren't blocked on schema work"). This migration
-- adds only what Phases 7-9 genuinely need and Phase 1 could not have known
-- the shape of:
--
--   1. Grievance CRM completion (SRS §13 rows that had no columns yet:
--      human-readable ticket id, SLA timers, escalation, reopen reason,
--      CSAT, reassignment history, response templates).
--   2. Customer 360 CRM support (SRS §7.2 "Admin Notes", §7.3 admin-created
--      auditable operational flags).
--   3. The two SRS V2 §U entities the Phase 1 schema did not create:
--      financial_reconciliation_items (§T) and sms_provider_events (§E).
--   4. Phase 9 platform-layer tables: notification templates, data-retention
--      policy register (§P), and operational-alert acknowledgements which
--      §F.1 requires ("Operational alerts must be auditable when
--      acknowledged/resolved").
--
-- Nothing here rewrites an existing financial or order record. Every addition
-- is either a new table or a nullable column, so this migration is safe to
-- apply to a live project that already has Phase 1-6 data.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. GRIEVANCE CRM COMPLETION (SRS §13, Phase 8)
-- ─────────────────────────────────────────────────────────────────────────

-- Human-readable ticket reference. SRS §7.1 requires the customer list to be
-- searchable by "ticket ID" and §13 requires a "Unique ID" — a uuid is unique
-- but unusable over a phone call with a student, so tickets get a short
-- sequential number alongside the uuid primary key. Backfilled for any
-- tickets already created in Phase 6 before this column existed.
alter table grievance_tickets add column if not exists ticket_no bigint;

create sequence if not exists grievance_ticket_no_seq as bigint start with 1001;

alter table grievance_tickets
  alter column ticket_no set default nextval('grievance_ticket_no_seq');

update grievance_tickets
  set ticket_no = nextval('grievance_ticket_no_seq')
  where ticket_no is null;

alter table grievance_tickets alter column ticket_no set not null;

alter sequence grievance_ticket_no_seq owned by grievance_tickets.ticket_no;

create unique index if not exists uq_grievance_tickets_ticket_no
  on grievance_tickets (ticket_no);

alter table grievance_tickets
  -- SLA (§13 "First-response and resolution timers; overdue highlighting").
  -- Stored as absolute DUE instants computed from the priority-based policy in
  -- admin_settings at creation time, rather than recomputed on read: if the
  -- policy changes later, an already-open ticket keeps the SLA it was promised
  -- (same snapshot principle as commission_rate_snapshot, SRS §11.5).
  add column if not exists first_response_due_at timestamptz,
  add column if not exists resolution_due_at timestamptz,
  add column if not exists sla_policy_snapshot jsonb,

  -- Escalation (§13 "Senior-admin/owner escalation with reason").
  add column if not exists escalated_at timestamptz,
  add column if not exists escalated_by uuid references profiles (id),
  add column if not exists escalation_reason text,

  -- Reopen (§13 "Requester/admin can reopen with reason; timeline preserved").
  -- reopened_count already exists from Phase 1; these record the latest reopen.
  add column if not exists reopened_at timestamptz,
  add column if not exists reopen_reason text,

  -- Closure is distinct from resolution: a ticket can be resolved and then
  -- closed, and the Phase 8 completion standard ("Closing requires a
  -- resolution note") needs both instants to reconstruct the timeline.
  add column if not exists closed_at timestamptz,

  -- Optional post-resolution CSAT (§13 "Customer satisfaction").
  add column if not exists csat_score smallint,
  add column if not exists csat_comment text,
  add column if not exists csat_submitted_at timestamptz;

alter table grievance_tickets
  drop constraint if exists grievance_tickets_csat_score_check;
alter table grievance_tickets
  add constraint grievance_tickets_csat_score_check
  check (csat_score is null or (csat_score between 1 and 5));

comment on column grievance_tickets.sla_policy_snapshot is
  'The grievance_sla_minutes policy in force when this ticket was created. '
  'Kept so a later policy change cannot retroactively make historical tickets '
  'look breached (or compliant).';

-- Reassignment history (§13 "Assign to Super Admin/support agent;
-- reassignment history"). Append-only; grievance_tickets.assignee_id stays
-- the current value for cheap filtering.
create table if not exists grievance_assignments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references grievance_tickets (id) on delete cascade,
  from_assignee_id uuid references profiles (id),
  to_assignee_id uuid references profiles (id),   -- null = unassigned
  actor_id uuid not null references profiles (id),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_grievance_assignments_ticket
  on grievance_assignments (ticket_id, created_at desc);

-- Approved response macros (§13 "Templates", Phase 8 "Support templates").
create table if not exists grievance_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category grievance_category,          -- null = applies to any category
  body text not null,
  is_active boolean not null default true,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_grievance_templates_name
  on grievance_templates (lower(name));

-- ─────────────────────────────────────────────────────────────────────────
-- 2. CUSTOMER 360 CRM (SRS §7)
-- ─────────────────────────────────────────────────────────────────────────

-- §7.2 "Admin Notes — Internal-only customer support notes with
-- author/timestamp and audit trail". Deliberately a separate table rather
-- than a text column on profiles: notes are append-only history, and a
-- customer must never be able to read them (see RLS in 0017).
create table if not exists customer_admin_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles (id) on delete cascade,
  author_id uuid not null references profiles (id),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_customer_admin_notes_customer
  on customer_admin_notes (customer_id, created_at desc);

-- §7.3 operational flags. The six listed flags (High Value, Frequent
-- Customer, Open Support Issue, Payment Issue, Repeated No-Shows, Frequent
-- Cancellations) are DERIVED from order/grievance data at read time — see
-- deriveCustomerFlags in lib/admin/customers.ts — precisely because the SRS
-- says "Flags must be
-- data-driven/operational, not arbitrary character judgments".
--
-- This table exists only for the sentence that follows it: "Any
-- admin-created flag must be auditable." An admin can pin a manual flag, and
-- it is recorded with actor, reason, and a clearing trail. Derived flags are
-- never written here.
create table if not exists customer_flags (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles (id) on delete cascade,
  flag text not null,
  reason text not null,
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now(),
  cleared_at timestamptz,
  cleared_by uuid references profiles (id),
  clear_reason text
);

create index if not exists idx_customer_flags_active
  on customer_flags (customer_id) where cleared_at is null;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. SRS V2 §U ENTITIES NOT CREATED IN PHASE 1
-- ─────────────────────────────────────────────────────────────────────────

-- §T Financial Reconciliation Dashboard / §U financial_reconciliation_items.
-- One row per detected mismatch. Detection is a read-side scan
-- (lib/data/admin-reconciliation.ts) and persisting a row is what lets an
-- admin triage/resolve it with an audit trail — SRS §T: "Resolution is manual
-- and auditable in V1".
create table if not exists financial_reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  item_type text not null check (item_type in (
    'payment_without_order',
    'order_payment_mismatch',
    'duplicate_payment_event',
    'refund_mismatch',
    'duplicate_payout',
    'payable_mismatch'
  )),
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  -- A stable identity for the mismatch so re-running detection updates the
  -- existing row instead of piling up duplicates every time an admin opens
  -- the dashboard.
  fingerprint text not null unique,
  restaurant_id uuid references restaurants (id),
  order_id uuid references orders (id),
  payment_id uuid references payments (id),
  disbursement_id uuid references disbursements (id),
  refund_event_id uuid references refund_events (id),
  expected_paise bigint,
  actual_paise bigint,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open'
    check (status in ('open', 'investigating', 'resolved', 'ignored')),
  detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_by uuid references profiles (id),
  resolved_at timestamptz,
  resolution_note text
);

create index if not exists idx_reconciliation_open
  on financial_reconciliation_items (status, detected_at desc);
create index if not exists idx_reconciliation_restaurant
  on financial_reconciliation_items (restaurant_id);

-- §U sms_provider_events / §E "Provider message ID, delivery/failure state
-- and template metadata". `notifications` (Phase 1) is the platform's own
-- record; this is the provider-side delivery trail, kept separate so a
-- provider swap does not require rewriting notification history.
create table if not exists sms_provider_events (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references notifications (id) on delete set null,
  provider text not null,                 -- e.g. 'console', 'msg91', 'gupshup'
  provider_message_id text,
  template text,
  to_phone_masked text,                   -- last 4 digits only; never store the full number twice
  status text not null default 'submitted'
    check (status in ('submitted', 'sent', 'delivered', 'failed', 'unknown')),
  error_code text,
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_sms_provider_events_notification
  on sms_provider_events (notification_id);
create index if not exists idx_sms_provider_events_created
  on sms_provider_events (created_at desc);

comment on column sms_provider_events.to_phone_masked is
  'Masked destination (e.g. "******7890"). The full number already lives on '
  'profiles.phone — duplicating it into a provider log would widen the '
  'PII blast radius for no operational benefit (SRS §17, V2 §P).';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. PHASE 9 PLATFORM LAYER
-- ─────────────────────────────────────────────────────────────────────────

-- Phase 9 deliverable "Notification templates where applicable" + §E.
-- Body uses {{placeholder}} tokens; `variables` documents which are valid so
-- the admin UI can validate a template before it is saved.
create table if not exists notification_templates (
  key text primary key,                  -- e.g. 'order_ready', 'pickup_reminder', 'otp'
  channel text not null default 'sms' check (channel in ('sms', 'inapp')),
  title text,
  body text not null,
  description text,
  variables jsonb not null default '[]'::jsonb,
  dlt_template_id text,                  -- India DLT registration id, provider-specific (§Y)
  is_active boolean not null default true,
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);

-- §F.1 "Operational alerts must be auditable when acknowledged/resolved".
-- Live-ops alerts are computed, not stored; this records the human response
-- to one so the command center can hide handled alerts without losing the
-- fact that somebody handled it.
create table if not exists operational_alert_acks (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null,              -- e.g. 'order_overdue_pickup', 'restaurant_paused'
  target_table text,
  target_id uuid,
  restaurant_id uuid references restaurants (id),
  acknowledged_by uuid not null references profiles (id),
  note text,
  created_at timestamptz not null default now(),
  cleared_at timestamptz,
  cleared_by uuid references profiles (id)
);

create unique index if not exists uq_operational_alert_ack_active
  on operational_alert_acks (alert_type, target_id)
  where cleared_at is null and target_id is not null;

create index if not exists idx_operational_alert_acks_active
  on operational_alert_acks (alert_type) where cleared_at is null;

-- §P Data Governance & Retention. V1 does not run automated deletion — the
-- SRS asks that "Retention periods and deletion/anonymization behaviour must
-- be documented before production launch". This table is that documentation,
-- kept in the database (and editable by Super Admin) rather than only in
-- markdown, so the operational policy and the documented policy cannot drift.
create table if not exists data_retention_policies (
  domain text primary key,               -- e.g. 'orders', 'audit_logs', 'payout_proofs'
  retention_period text not null,        -- human-readable, e.g. '7 years', 'indefinite'
  disposition text not null check (disposition in
    ('retain_indefinitely', 'archive', 'anonymize', 'delete')),
  rationale text,
  automated boolean not null default false,
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);

-- Announcements (§O) gained edit/archive semantics in Phase 9; Phase 1 only
-- modelled create + publish.
alter table announcements
  add column if not exists updated_by uuid references profiles (id),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists archived_at timestamptz;

-- fraud_flags (§S) gained a resolution note so "acknowledge, investigate and
-- resolve" produces a readable trail, and a signal/subject uniqueness guard
-- so a repeated detection updates rather than floods.
alter table fraud_flags
  add column if not exists resolution_note text,
  add column if not exists occurrences integer not null default 1,
  add column if not exists last_seen_at timestamptz not null default now();

create unique index if not exists uq_fraud_flags_open_signal
  on fraud_flags (subject_type, subject_id, signal)
  where status in ('open', 'investigating');

-- Keep updated_at honest on the tables that now expose it in admin UIs.
-- set_updated_at() is defined in 0007 and hardened in 0012.
drop trigger if exists trg_grievance_templates_updated_at on grievance_templates;
create trigger trg_grievance_templates_updated_at
  before update on grievance_templates
  for each row execute function set_updated_at();

drop trigger if exists trg_announcements_updated_at on announcements;
create trigger trg_announcements_updated_at
  before update on announcements
  for each row execute function set_updated_at();

drop trigger if exists trg_notification_templates_updated_at on notification_templates;
create trigger trg_notification_templates_updated_at
  before update on notification_templates
  for each row execute function set_updated_at();

drop trigger if exists trg_data_retention_policies_updated_at on data_retention_policies;
create trigger trg_data_retention_policies_updated_at
  before update on data_retention_policies
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 5. SEEDS FOR THE NEW POLICY SURFACES
-- ─────────────────────────────────────────────────────────────────────────
-- Same convention as 0008: `on conflict do nothing`, so re-running the
-- migration never overwrites a value an admin has since changed through
-- /admin/settings.

-- Grievance SLA policy (§13 "first-response and resolution timers"). Keyed by
-- grievance_priority, minutes from ticket creation. lib/grievance/sla.ts reads
-- this and snapshots it onto the ticket.
insert into admin_settings (key, value, description) values
  (
    'grievance_sla_minutes',
    '{
       "urgent": { "first_response": 30,  "resolution": 240 },
       "high":   { "first_response": 60,  "resolution": 480 },
       "normal": { "first_response": 240, "resolution": 1440 },
       "low":    { "first_response": 480, "resolution": 4320 }
     }'::jsonb,
    'First-response and resolution SLA in minutes per grievance priority (SRS §13).'
  ),
  -- Platform-wide defaults applied to newly created restaurants (Phase 9
  -- "Preparation/grace policies", "Pickup capacity configuration"). Existing
  -- restaurants keep their own per-restaurant columns; these are only the
  -- values a new restaurant starts from.
  (
    'default_preparation_minutes',
    '10'::jsonb,
    'preparation_default_minutes for newly created restaurants (SRS §6, §22).'
  ),
  (
    'default_slot_interval_minutes',
    '15'::jsonb,
    'pickup_slot_interval_minutes for newly created restaurants (SRS §22).'
  ),
  (
    'default_slot_capacity',
    '8'::jsonb,
    'default_slot_capacity for newly created restaurants (SRS §22).'
  ),
  -- Thresholds behind the §7.3 derived customer flags. Kept in settings rather
  -- than hard-coded so "high value" can be tuned per campus without a deploy.
  (
    'customer_flag_thresholds',
    '{
       "high_value_lifetime_paise": 500000,
       "frequent_customer_orders": 10,
       "repeated_no_shows": 2,
       "frequent_cancellations": 3,
       "lookback_days": 90
     }'::jsonb,
    'Thresholds for the data-driven Customer 360 operational flags (SRS §7.3).'
  ),
  -- §F live-ops alert tuning.
  (
    'live_ops_thresholds',
    '{
       "due_soon_minutes": 30,
       "not_started_minutes_before_pickup": 20,
       "ready_overdue_minutes": 5,
       "pickup_overdue_minutes": 15,
       "capacity_warning_ratio": 0.8
     }'::jsonb,
    'Windows and ratios used by the Live Operations Command Center (SRS V2 §F).'
  )
on conflict (key) do nothing;

-- The templates the platform already sends (lib/notifications/*) plus the
-- pickup reminder Phase 9 exposes for editing. `key` matches
-- notifications.template so the admin UI can join delivery history to the
-- template that produced it.
insert into notification_templates (key, channel, title, body, description, variables) values
  (
    'order_paid',
    'sms',
    'Order confirmed',
    'UNI8: Payment received. Your order at {{restaurant}} is confirmed for {{pickup_time}}. Show your QR at the counter.',
    'Sent once a Razorpay payment is captured and orders are finalized.',
    '["restaurant", "pickup_time"]'::jsonb
  ),
  (
    'order_ready',
    'sms',
    'Order ready',
    'UNI8: Your order at {{restaurant}} is ready for pickup. Show your QR at the counter.',
    'Sent when staff or the auto-ready job marks an order ready_for_pickup.',
    '["restaurant"]'::jsonb
  ),
  (
    'pickup_reminder',
    'sms',
    'Pickup reminder',
    'UNI8: Reminder — pickup at {{restaurant}} at {{pickup_time}}. Grace period {{grace_minutes}} min.',
    'Optional reminder ahead of a scheduled pickup slot.',
    '["restaurant", "pickup_time", "grace_minutes"]'::jsonb
  ),
  (
    'order_cancelled_by_restaurant',
    'sms',
    'Order cancelled',
    'UNI8: {{restaurant}} cancelled your order. A full refund of {{amount}} has been initiated.',
    'Sent on a restaurant-initiated cancellation (SRS §12 penalty flow).',
    '["restaurant", "amount"]'::jsonb
  ),
  (
    'refund_processed',
    'sms',
    'Refund processed',
    'UNI8: A refund of {{amount}} for your order at {{restaurant}} has been processed.',
    'Sent when a refund_event reaches succeeded.',
    '["restaurant", "amount"]'::jsonb
  ),
  (
    'grievance_update',
    'inapp',
    'Support update',
    'Ticket #{{ticket_no}}: {{message}}',
    'Support replied on a grievance ticket.',
    '["ticket_no", "message"]'::jsonb
  )
on conflict (key) do nothing;

-- §P register. Seeded with the policy the platform actually follows today, so
-- the launch checklist item is satisfied by real rows rather than a promise.
-- Note every disposition below is non-destructive: SRS §8 forbids erasing
-- authentication/audit history, and §P prefers archival/anonymization.
insert into data_retention_policies (domain, retention_period, disposition, rationale, automated) values
  ('orders', 'indefinite', 'retain_indefinitely',
   'Financial record. Orders carry commission and payable snapshots needed to defend historical settlements.', false),
  ('payments', 'indefinite', 'retain_indefinitely',
   'Financial record reconciled against the payment provider (SRS §T).', false),
  ('payment_events', '3 years', 'archive',
   'Provider webhook payloads. Needed for dispute windows, then archivable.', false),
  ('refund_events', 'indefinite', 'retain_indefinitely',
   'Additive correction ledger — deleting a row would silently alter financial history.', false),
  ('disbursements', 'indefinite', 'retain_indefinitely',
   'Payout evidence including proof documents and vendor acknowledgement.', false),
  ('audit_logs', 'indefinite', 'retain_indefinitely',
   'SRS §8 and §16: privileged-action history must be preserved, never erased.', false),
  ('grievance_tickets', '3 years', 'archive',
   'Support history after closure; retained for repeat-issue detection.', false),
  ('grievance_attachments', '1 year after closure', 'delete',
   'Customer-uploaded evidence in a private bucket; the smallest useful window for PII.', false),
  ('notifications', '1 year', 'delete',
   'Delivery log; superseded by sms_provider_events for provider-side detail.', false),
  ('sms_provider_events', '1 year', 'delete',
   'Provider delivery trail; destination is already masked.', false),
  ('profiles', 'indefinite', 'anonymize',
   'Deactivated accounts are disabled, never deleted (SRS §8); anonymization on request preserves order integrity.', false),
  ('carts', '30 days', 'delete',
   'Abandoned carts hold no financial meaning.', false),
  ('payout_proofs', 'indefinite', 'retain_indefinitely',
   'Storage objects supporting disbursement records.', false)
on conflict (domain) do nothing;
