-- UNI8 — Developer 3, Phases 7-9
-- 0019_admin_performance_indexes.sql
--
-- Indexes for the access patterns Phases 7-9 introduce. Phase 1-6 indexed the
-- customer and vendor paths (orders by customer, orders by restaurant+slot,
-- audit by target). The Super Admin command center reads differently: it scans
-- *globally* and orders by time, which the existing per-restaurant indexes do
-- not serve.
--
-- Every index below names the query it exists for. None of them change
-- behaviour, so this migration is safe to re-run and safe to skip if a DBA
-- prefers to tune differently.

-- ─────────────────────────────────────────────────────────────────────────
-- Phase 7: global orders and live operations
-- ─────────────────────────────────────────────────────────────────────────

-- /admin/orders default view: newest first across all restaurants, paginated.
-- idx_orders_status alone cannot satisfy the ORDER BY, so a global date index
-- is needed for the unfiltered list.
create index if not exists idx_orders_created_at_desc
  on orders (created_at desc);

-- Live Operations Command Center (§F): "orders due for pickup soon", "orders
-- not started", "orders past pickup time" all filter on an ACTIVE status set
-- and order by pickup_time. A partial index keeps it small — collected and
-- cancelled orders are the overwhelming majority over time and are never
-- part of a live-ops alert.
create index if not exists idx_orders_live_ops
  on orders (pickup_time)
  where status in ('paid', 'scheduled', 'preparing', 'ready_for_pickup');

-- §F "restaurant cancellations and 49% penalty events" — newest first.
create index if not exists idx_restaurant_cancellation_events_created
  on restaurant_cancellation_events (created_at desc);

-- §F "vendor payouts awaiting acknowledgement".
create index if not exists idx_disbursements_pending_ack
  on disbursements (created_at desc)
  where status = 'pending';

-- Outstanding-payable KPI on both the global and restaurant dashboards:
-- sum(amount_paise - disbursed_amount_paise) where not fully disbursed.
create index if not exists idx_vendor_payables_outstanding
  on vendor_payables (restaurant_id)
  where disbursed_amount_paise < amount_paise;

-- ─────────────────────────────────────────────────────────────────────────
-- Phase 8: Customer 360 and grievance CRM
-- ─────────────────────────────────────────────────────────────────────────

-- §7.1 customer directory sorted by signup date, filtered by role/status.
-- The directory only ever lists customers, so the role predicate is baked in.
create index if not exists idx_profiles_customers
  on profiles (created_at desc)
  where role = 'customer';

-- §7.1 "Search by name/phone/email". phone and email are already unique
-- (hence indexed); name is not. A prefix index on lower(name) serves the
-- `ilike 'term%'` search the directory performs. Not a trigram index —
-- pg_trgm is not among the extensions 0001 enables, and adding an extension
-- for a campus-sized customer table is not justified.
create index if not exists idx_profiles_name_lower
  on profiles (lower(name));

-- Customer 360 "Orders" and "Activity Timeline" tabs: one customer, newest
-- first. idx_orders_customer has no sort key.
create index if not exists idx_orders_customer_created
  on orders (customer_id, created_at desc);

-- Customer 360 "Payments" tab.
create index if not exists idx_payments_customer_created
  on payments (customer_id, created_at desc);

-- Customer 360 "Ratings" tab and restaurant Ratings page.
create index if not exists idx_ratings_customer
  on ratings (customer_id, created_at desc);
create index if not exists idx_ratings_restaurant
  on ratings (restaurant_id, created_at desc);

-- Central grievance queues (§13): the default view is open tickets by
-- priority then age, filtered by requester_role to split the customer queue
-- from the vendor queue.
create index if not exists idx_grievance_tickets_queue
  on grievance_tickets (requester_role, status, priority, created_at desc);

-- "Open issues" column in the customer directory and the Customer 360
-- Grievances tab.
create index if not exists idx_grievance_tickets_requester
  on grievance_tickets (requester_id, created_at desc);

-- Restaurant workspace Grievances page.
create index if not exists idx_grievance_tickets_restaurant
  on grievance_tickets (restaurant_id, created_at desc)
  where restaurant_id is not null;

-- SLA breach highlighting (§13 "overdue highlighting"). Only unresolved
-- tickets can breach, so the index excludes terminal states.
create index if not exists idx_grievance_tickets_sla_open
  on grievance_tickets (resolution_due_at)
  where status not in ('resolved', 'closed');

-- Ticket detail view loads the full immutable timeline in order.
create index if not exists idx_grievance_messages_ticket
  on grievance_messages (ticket_id, created_at);
create index if not exists idx_grievance_events_ticket
  on grievance_events (ticket_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────
-- Phase 9: analytics, audit log and reconciliation
-- ─────────────────────────────────────────────────────────────────────────

-- Global Audit Log filters by actor and by action, and always sorts by time.
-- 0004 indexed target, restaurant and created_at separately.
create index if not exists idx_audit_logs_actor_created
  on audit_logs (actor_id, created_at desc);
create index if not exists idx_audit_logs_action_created
  on audit_logs (action, created_at desc);

-- Analytics aggregates GMV/AOV per restaurant over a date range, counting
-- only revenue-bearing orders. Cancelled and refunded orders are excluded
-- from GMV (SRS §14), so they are excluded from the index too.
create index if not exists idx_orders_revenue_analytics
  on orders (restaurant_id, created_at)
  where status in ('paid', 'scheduled', 'preparing', 'ready_for_pickup', 'collected');

-- Product performance analytics joins order_items to orders by product.
create index if not exists idx_order_items_product
  on order_items (product_id);

-- Reconciliation scan (§T) walks payments and payment_events by time and
-- looks for duplicate provider events.
create index if not exists idx_payments_created_at
  on payments (created_at desc);
create index if not exists idx_payment_events_payment
  on payment_events (payment_id, created_at);

-- Refund mismatch detection and the Customer 360 refund history.
create index if not exists idx_refund_events_order
  on refund_events (order_id, created_at desc);

-- §S fraud queue: open flags newest first.
create index if not exists idx_fraud_flags_open
  on fraud_flags (created_at desc)
  where status in ('open', 'investigating');

-- §O announcements: the customer-visible query is "published, in window,
-- not archived".
create index if not exists idx_announcements_live
  on announcements (starts_at, ends_at)
  where is_published and archived_at is null;

-- SMS administration page (§E) lists recent delivery attempts, and the
-- failure view filters on status.
create index if not exists idx_notifications_created
  on notifications (created_at desc);
create index if not exists idx_notifications_failed
  on notifications (created_at desc)
  where status = 'failed';
