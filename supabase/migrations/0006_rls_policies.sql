-- UNI8 — Phase 1 Foundation
-- 0006_rls_policies.sql
--
-- Every table in the exposed schema gets RLS enabled + FORCE ROW LEVEL
-- SECURITY (so even the table owner is subject to it in application
-- contexts), per SRS §17: "All exposed Supabase tables must use appropriate
-- RLS policies." Privileged server-only writes (webhooks, disbursements,
-- audit writes, credential resets) go through the service-role client in
-- lib/supabase/server.ts, which is a deliberate, documented bypass — never
-- an accidental one.

-- ─────────────────────────────────────────────────────────────────────────
-- profiles
-- ─────────────────────────────────────────────────────────────────────────
alter table profiles enable row level security;
alter table profiles force row level security;

create policy "profiles_select_self" on profiles
  for select using (id = auth.uid());

create policy "profiles_select_super_admin" on profiles
  for select using (is_super_admin());

-- A vendor admin / staff manager needs to see the people they manage.
create policy "profiles_select_by_restaurant_manager" on profiles
  for select using (
    exists (
      select 1 from restaurant_staff rs
      where rs.user_id = profiles.id
        and rs.restaurant_id in (select my_restaurant_ids())
    )
    or exists (
      select 1 from vendor_admin_memberships vam
      where vam.user_id = profiles.id
        and vam.restaurant_id in (select my_restaurant_ids())
    )
  );

create policy "profiles_update_self" on profiles
  for update using (id = auth.uid());

create policy "profiles_update_super_admin" on profiles
  for update using (is_super_admin());

create policy "profiles_insert_self" on profiles
  for insert with check (id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────
-- restaurants / hours / exceptions / walking_times
-- ─────────────────────────────────────────────────────────────────────────
alter table restaurants enable row level security;
alter table restaurants force row level security;

create policy "restaurants_select_active_public" on restaurants
  for select using (status <> 'archived' or is_super_admin());

create policy "restaurants_all_super_admin" on restaurants
  for all using (is_super_admin()) with check (is_super_admin());

create policy "restaurants_update_own_vendor_admin" on restaurants
  for update using (is_active_vendor_admin_for(id));

alter table restaurant_hours enable row level security;
alter table restaurant_hours force row level security;
create policy "restaurant_hours_select_all" on restaurant_hours for select using (true);
create policy "restaurant_hours_write_scoped" on restaurant_hours
  for all using (is_super_admin() or is_active_vendor_admin_for(restaurant_id))
  with check (is_super_admin() or is_active_vendor_admin_for(restaurant_id));

alter table restaurant_hour_exceptions enable row level security;
alter table restaurant_hour_exceptions force row level security;
create policy "restaurant_hour_exceptions_select_all" on restaurant_hour_exceptions for select using (true);
create policy "restaurant_hour_exceptions_write_scoped" on restaurant_hour_exceptions
  for all using (is_super_admin() or is_active_vendor_admin_for(restaurant_id))
  with check (is_super_admin() or is_active_vendor_admin_for(restaurant_id));

alter table walking_times enable row level security;
alter table walking_times force row level security;
create policy "walking_times_select_all" on walking_times for select using (true);
create policy "walking_times_write_super_admin" on walking_times
  for all using (is_super_admin()) with check (is_super_admin());

-- ─────────────────────────────────────────────────────────────────────────
-- vendor_admin_memberships / restaurant_staff — Super Admin controls these
-- exclusively (SRS §8: create/disable/reset are all Super Admin actions).
-- ─────────────────────────────────────────────────────────────────────────
alter table vendor_admin_memberships enable row level security;
alter table vendor_admin_memberships force row level security;
create policy "vendor_admin_memberships_select_own" on vendor_admin_memberships
  for select using (user_id = auth.uid() or is_super_admin());
create policy "vendor_admin_memberships_write_super_admin" on vendor_admin_memberships
  for all using (is_super_admin()) with check (is_super_admin());

alter table restaurant_staff enable row level security;
alter table restaurant_staff force row level security;
create policy "restaurant_staff_select_own_or_scoped" on restaurant_staff
  for select using (
    user_id = auth.uid()
    or is_super_admin()
    or is_active_vendor_admin_for(restaurant_id)
  );
create policy "restaurant_staff_write_super_admin_or_vendor" on restaurant_staff
  for all using (is_super_admin() or is_active_vendor_admin_for(restaurant_id))
  with check (is_super_admin() or is_active_vendor_admin_for(restaurant_id));

-- ─────────────────────────────────────────────────────────────────────────
-- product_categories / products
-- ─────────────────────────────────────────────────────────────────────────
alter table product_categories enable row level security;
alter table product_categories force row level security;
create policy "product_categories_select_all" on product_categories for select using (true);
create policy "product_categories_write_scoped" on product_categories
  for all using (is_super_admin() or is_active_vendor_admin_for(restaurant_id))
  with check (is_super_admin() or is_active_vendor_admin_for(restaurant_id));

alter table products enable row level security;
alter table products force row level security;
create policy "products_select_all" on products for select using (true);
create policy "products_write_scoped" on products
  for all using (is_super_admin() or is_active_vendor_admin_for(restaurant_id))
  with check (is_super_admin() or is_active_vendor_admin_for(restaurant_id));

-- ─────────────────────────────────────────────────────────────────────────
-- carts / cart_items — customer's own only
-- ─────────────────────────────────────────────────────────────────────────
alter table carts enable row level security;
alter table carts force row level security;
create policy "carts_owner_only" on carts
  for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());

alter table cart_items enable row level security;
alter table cart_items force row level security;
create policy "cart_items_owner_only" on cart_items
  for all using (exists (select 1 from carts c where c.id = cart_id and c.customer_id = auth.uid()))
  with check (exists (select 1 from carts c where c.id = cart_id and c.customer_id = auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────
-- multi_order_groups / pickup_sequences
-- ─────────────────────────────────────────────────────────────────────────
alter table multi_order_groups enable row level security;
alter table multi_order_groups force row level security;
create policy "groups_select_owner_or_staff" on multi_order_groups
  for select using (
    customer_id = auth.uid()
    or is_super_admin()
    or exists (
      select 1 from orders o
      where o.group_id = id and o.restaurant_id in (select my_restaurant_ids())
    )
  );
create policy "groups_insert_owner" on multi_order_groups
  for insert with check (customer_id = auth.uid());

alter table pickup_sequences enable row level security;
alter table pickup_sequences force row level security;
create policy "pickup_sequences_select_scoped" on pickup_sequences
  for select using (
    is_super_admin()
    or restaurant_id in (select my_restaurant_ids())
    or exists (
      select 1 from multi_order_groups g
      where g.id = group_id and g.customer_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- orders / order_items — the core scoped table. No direct client UPDATE of
-- `status`: transitions go through server-side functions/actions only
-- (SRS §14). The policy below still permits SELECT broadly by scope and
-- restricts INSERT to the owning customer; status-mutating verbs are
-- performed by server actions using the service-role client, never by an
-- anon-key client UPDATE.
-- ─────────────────────────────────────────────────────────────────────────
alter table orders enable row level security;
alter table orders force row level security;

create policy "orders_select_scoped" on orders
  for select using (
    customer_id = auth.uid()
    or is_super_admin()
    or restaurant_id in (select my_restaurant_ids())
  );

create policy "orders_insert_owner" on orders
  for insert with check (customer_id = auth.uid());

-- No client-side UPDATE/DELETE policy is defined deliberately. All status
-- transitions, cancellations, and financial snapshots are written by
-- server actions via the service-role client (see lib/supabase/server.ts
-- `createServiceRoleClient`), which bypasses RLS by design and is the
-- ONLY code path permitted to mutate order state. Do not add a broad
-- client-writable UPDATE policy here in later phases without a review.

alter table order_items enable row level security;
alter table order_items force row level security;
create policy "order_items_select_scoped" on order_items
  for select using (
    exists (
      select 1 from orders o
      where o.id = order_id
        and (
          o.customer_id = auth.uid()
          or is_super_admin()
          or o.restaurant_id in (select my_restaurant_ids())
        )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- payments / payment_events / refund_events — financial truth. Read-scoped
-- only; all writes are server/webhook-only via service-role client.
-- ─────────────────────────────────────────────────────────────────────────
alter table payments enable row level security;
alter table payments force row level security;
create policy "payments_select_scoped" on payments
  for select using (customer_id = auth.uid() or is_super_admin());

alter table payment_events enable row level security;
alter table payment_events force row level security;
create policy "payment_events_select_super_admin" on payment_events
  for select using (is_super_admin());

alter table refund_events enable row level security;
alter table refund_events force row level security;
create policy "refund_events_select_scoped" on refund_events
  for select using (
    is_super_admin()
    or exists (select 1 from orders o where o.id = order_id and o.customer_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────────────────
-- vendor_payables / disbursements / restaurant_cancellation_events
-- ─────────────────────────────────────────────────────────────────────────
alter table vendor_payables enable row level security;
alter table vendor_payables force row level security;
create policy "vendor_payables_select_scoped" on vendor_payables
  for select using (is_super_admin() or restaurant_id in (select my_restaurant_ids()));

alter table disbursements enable row level security;
alter table disbursements force row level security;
create policy "disbursements_select_scoped" on disbursements
  for select using (is_super_admin() or restaurant_id in (select my_restaurant_ids()));
create policy "disbursements_ack_vendor" on disbursements
  for update using (is_active_vendor_admin_for(restaurant_id))
  with check (is_active_vendor_admin_for(restaurant_id));
  -- App layer restricts this to the acknowledgement fields only
  -- (Received / Not Received) — see lib/actions/vendor/acknowledge-payout.ts.

alter table restaurant_cancellation_events enable row level security;
alter table restaurant_cancellation_events force row level security;
create policy "cancellation_events_select_scoped" on restaurant_cancellation_events
  for select using (is_super_admin() or restaurant_id in (select my_restaurant_ids()));

-- ─────────────────────────────────────────────────────────────────────────
-- Grievance CRM — customer/vendor see only their own tickets; UNI8 support
-- (super_admin) sees everything. Vendor Admin NEVER sees customer tickets
-- (SRS §4, §13 — hard requirement).
-- ─────────────────────────────────────────────────────────────────────────
alter table grievance_tickets enable row level security;
alter table grievance_tickets force row level security;
create policy "grievance_tickets_select_own_or_admin" on grievance_tickets
  for select using (requester_id = auth.uid() or is_super_admin());
create policy "grievance_tickets_insert_own" on grievance_tickets
  for insert with check (requester_id = auth.uid());
create policy "grievance_tickets_update_super_admin" on grievance_tickets
  for update using (is_super_admin());

alter table grievance_messages enable row level security;
alter table grievance_messages force row level security;
create policy "grievance_messages_select_scoped" on grievance_messages
  for select using (
    (not is_internal and exists (
      select 1 from grievance_tickets t where t.id = ticket_id and t.requester_id = auth.uid()
    ))
    or is_super_admin()
  );
create policy "grievance_messages_insert_scoped" on grievance_messages
  for insert with check (
    sender_id = auth.uid()
    and (
      is_super_admin()
      or (not is_internal and exists (
        select 1 from grievance_tickets t where t.id = ticket_id and t.requester_id = auth.uid()
      ))
    )
  );

alter table grievance_attachments enable row level security;
alter table grievance_attachments force row level security;
create policy "grievance_attachments_select_scoped" on grievance_attachments
  for select using (
    is_super_admin()
    or exists (select 1 from grievance_tickets t where t.id = ticket_id and t.requester_id = auth.uid())
  );
create policy "grievance_attachments_insert_scoped" on grievance_attachments
  for insert with check (
    uploaded_by = auth.uid()
    and (
      is_super_admin()
      or exists (select 1 from grievance_tickets t where t.id = ticket_id and t.requester_id = auth.uid())
    )
  );

alter table grievance_events enable row level security;
alter table grievance_events force row level security;
create policy "grievance_events_select_scoped" on grievance_events
  for select using (
    is_super_admin()
    or exists (select 1 from grievance_tickets t where t.id = ticket_id and t.requester_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────────────────
-- ratings
-- ─────────────────────────────────────────────────────────────────────────
alter table ratings enable row level security;
alter table ratings force row level security;
create policy "ratings_select_all" on ratings for select using (true);
create policy "ratings_insert_owner" on ratings
  for insert with check (
    customer_id = auth.uid()
    and exists (
      select 1 from orders o
      where o.id = order_id and o.customer_id = auth.uid() and o.status = 'collected'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────
-- notifications — user sees only their own
-- ─────────────────────────────────────────────────────────────────────────
alter table notifications enable row level security;
alter table notifications force row level security;
create policy "notifications_select_own" on notifications
  for select using (user_id = auth.uid() or is_super_admin());

-- ─────────────────────────────────────────────────────────────────────────
-- audit_logs — Super Admin (global) or restaurant-scoped manager (their
-- restaurant's slice only). No client-side writes, ever — see lib/audit.
-- ─────────────────────────────────────────────────────────────────────────
alter table audit_logs enable row level security;
alter table audit_logs force row level security;
create policy "audit_logs_select_scoped" on audit_logs
  for select using (
    is_super_admin()
    or (restaurant_id is not null and restaurant_id in (select my_restaurant_ids()))
  );

-- ─────────────────────────────────────────────────────────────────────────
-- Platform configuration — readable broadly where needed for correct pricing
-- display, writable by Super Admin only.
-- ─────────────────────────────────────────────────────────────────────────
alter table admin_settings enable row level security;
alter table admin_settings force row level security;
create policy "admin_settings_select_all" on admin_settings for select using (true);
create policy "admin_settings_write_super_admin" on admin_settings
  for all using (is_super_admin()) with check (is_super_admin());

alter table feature_flags enable row level security;
alter table feature_flags force row level security;
create policy "feature_flags_select_all" on feature_flags for select using (true);
create policy "feature_flags_write_super_admin" on feature_flags
  for all using (is_super_admin()) with check (is_super_admin());

alter table announcements enable row level security;
alter table announcements force row level security;
create policy "announcements_select_published" on announcements
  for select using (is_published or is_super_admin());
create policy "announcements_write_super_admin" on announcements
  for all using (is_super_admin()) with check (is_super_admin());

alter table maintenance_mode enable row level security;
alter table maintenance_mode force row level security;
create policy "maintenance_mode_select_all" on maintenance_mode for select using (true);
create policy "maintenance_mode_write_super_admin" on maintenance_mode
  for all using (is_super_admin()) with check (is_super_admin());

alter table fraud_flags enable row level security;
alter table fraud_flags force row level security;
create policy "fraud_flags_select_super_admin" on fraud_flags
  for select using (is_super_admin());
create policy "fraud_flags_write_super_admin" on fraud_flags
  for all using (is_super_admin()) with check (is_super_admin());
