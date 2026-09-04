-- UNI8 — Developer 3, Phases 7-9
-- 0017_phase7_9_rls.sql
--
-- RLS for every table created in 0016. Same rule as 0006: `enable` +
-- `force row level security` on all of them, per SRS §17. Writes from admin
-- server actions go through the service-role client (which bypasses RLS by
-- design) *after* a lib/auth/guards.ts check, so most of these tables only
-- need a select policy for the UI reads that run on the RLS-bound client.
--
-- The default posture here is "super admin only". That is deliberate: every
-- table in 0016 is either internal CRM data (admin notes, manual flags),
-- financial forensics (reconciliation), or platform configuration. Where a
-- non-admin needs visibility the policy says so explicitly and narrowly.
--
-- A table with RLS forced and no permissive policy is not "broken" — it is
-- readable only through the service role. That is the correct configuration
-- for sms_provider_events-style logs, and it is stated per table below so a
-- future reader does not "fix" it by adding a public policy.

-- ─────────────────────────────────────────────────────────────────────────
-- Grievance CRM additions
-- ─────────────────────────────────────────────────────────────────────────

alter table grievance_assignments enable row level security;
alter table grievance_assignments force row level security;

-- Assignment history is internal support routing. A requester (customer or
-- vendor) has no business knowing which agent a ticket bounced between —
-- SRS §13 lists reassignment history under the admin CRM, not the requester
-- timeline, and §7.2 keeps internal support data admin-only.
create policy "grievance_assignments_select_super_admin" on grievance_assignments
  for select using (is_super_admin());

alter table grievance_templates enable row level security;
alter table grievance_templates force row level security;

-- Templates are drafting aids for support agents only. If a requester could
-- read them they would see canned language before it is sent, and the macro
-- list itself hints at internal process.
create policy "grievance_templates_select_super_admin" on grievance_templates
  for select using (is_super_admin());

create policy "grievance_templates_write_super_admin" on grievance_templates
  for all using (is_super_admin()) with check (is_super_admin());

-- ─────────────────────────────────────────────────────────────────────────
-- Customer 360 (SRS §7)
-- ─────────────────────────────────────────────────────────────────────────

alter table customer_admin_notes enable row level security;
alter table customer_admin_notes force row level security;

-- §7.2: "Internal-only customer support notes". The customer the note is
-- ABOUT must not be able to read it, which is why there is no
-- `customer_id = auth.uid()` clause here and why notes are not a column on
-- profiles (profiles_select_self would have exposed them).
create policy "customer_admin_notes_select_super_admin" on customer_admin_notes
  for select using (is_super_admin());

create policy "customer_admin_notes_write_super_admin" on customer_admin_notes
  for all using (is_super_admin()) with check (is_super_admin());

alter table customer_flags enable row level security;
alter table customer_flags force row level security;

-- Same reasoning: a manual operational flag ("suspected refund abuse") is an
-- internal annotation. Vendor admins are also excluded — a restaurant sees
-- its own orders, not the platform's view of a customer.
create policy "customer_flags_select_super_admin" on customer_flags
  for select using (is_super_admin());

create policy "customer_flags_write_super_admin" on customer_flags
  for all using (is_super_admin()) with check (is_super_admin());

-- ─────────────────────────────────────────────────────────────────────────
-- Financial reconciliation (SRS V2 §T)
-- ─────────────────────────────────────────────────────────────────────────

alter table financial_reconciliation_items enable row level security;
alter table financial_reconciliation_items force row level security;

-- Reconciliation exposes cross-restaurant financial detail (a mismatch row
-- can reference another restaurant's payment). Restricting it to super admins
-- avoids leaking one vendor's numbers to another, which the §26 tenancy rule
-- forbids. Detection/resolution writes run service-role from
-- lib/actions/admin/reconciliation.ts after requireSuperAdmin().
create policy "financial_reconciliation_select_super_admin" on financial_reconciliation_items
  for select using (is_super_admin());

create policy "financial_reconciliation_write_super_admin" on financial_reconciliation_items
  for all using (is_super_admin()) with check (is_super_admin());

-- ─────────────────────────────────────────────────────────────────────────
-- SMS provider trail (SRS V2 §E, §U)
-- ─────────────────────────────────────────────────────────────────────────

alter table sms_provider_events enable row level security;
alter table sms_provider_events force row level security;

-- Read-only for super admins; there is intentionally NO insert policy.
-- Provider events are written exclusively by lib/notifications/send.ts
-- through the service-role client. Allowing an authenticated client to insert
-- would let a caller forge delivery receipts.
create policy "sms_provider_events_select_super_admin" on sms_provider_events
  for select using (is_super_admin());

-- ─────────────────────────────────────────────────────────────────────────
-- Platform layer (Phase 9)
-- ─────────────────────────────────────────────────────────────────────────

alter table notification_templates enable row level security;
alter table notification_templates force row level security;

-- Templates describe the SMS copy the platform sends. Readable by any signed-in
-- user is unnecessary; the sender runs service-role. Admin-only, mirroring the
-- admin_settings / feature_flags write posture in 0006.
create policy "notification_templates_select_super_admin" on notification_templates
  for select using (is_super_admin());

create policy "notification_templates_write_super_admin" on notification_templates
  for all using (is_super_admin()) with check (is_super_admin());

alter table operational_alert_acks enable row level security;
alter table operational_alert_acks force row level security;

-- §F.1 requires acknowledgements to be auditable. Vendor admins are given a
-- scoped read: an alert about their restaurant being paused or over capacity
-- is operationally relevant to them, and seeing "acknowledged by UNI8 support"
-- prevents duplicate escalation. They cannot write.
create policy "operational_alert_acks_select_super_admin" on operational_alert_acks
  for select using (is_super_admin());

create policy "operational_alert_acks_select_own_restaurant" on operational_alert_acks
  for select using (
    restaurant_id is not null
    and restaurant_id in (select my_restaurant_ids())
  );

create policy "operational_alert_acks_write_super_admin" on operational_alert_acks
  for all using (is_super_admin()) with check (is_super_admin());

alter table data_retention_policies enable row level security;
alter table data_retention_policies force row level security;

-- §P asks that retention behaviour be *documented*. Keeping the register
-- readable by any authenticated user would be harmless, but the policy text
-- names internal domains and dispositions, so it follows the same admin-only
-- rule as the rest of the platform configuration surface.
create policy "data_retention_policies_select_super_admin" on data_retention_policies
  for select using (is_super_admin());

create policy "data_retention_policies_write_super_admin" on data_retention_policies
  for all using (is_super_admin()) with check (is_super_admin());
