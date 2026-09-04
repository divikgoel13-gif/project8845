-- UNI8 — Phase 1 Foundation
-- 0008_seed_platform_settings.sql
--
-- Default platform configuration. These are the ONLY places the launch
-- commission rate (8%) and cancellation penalty rate (49%) may live —
-- never hardcoded in application code (SRS §1.2, §23; SRS V2 §A/§C.2).

insert into admin_settings (key, value, description) values
  (
    'commission_rate',
    '0.08',
    'UNI8 platform commission as a fraction of the final amount paid by the '
    'customer for the applicable vendor order. Launch default 8% per SRS §1.2. '
    'Changing this value must never retroactively alter orders.commission_rate_snapshot '
    'on existing orders — see SRS §23.'
  ),
  (
    'restaurant_cancellation_penalty_rate',
    '0.49',
    'Penalty charged to a restaurant for a restaurant-initiated cancellation, '
    'as a fraction of the cancelled order value (final customer-paid amount). '
    'Default 49% per SRS V2 §A/§C.2.'
  ),
  (
    'auto_ready_grace_minutes',
    '5',
    'Minutes after scheduled pickup time at which an order not yet manually '
    'marked ready automatically transitions to ready_for_pickup. SRS V2 §B.2.'
  ),
  (
    'default_grace_period_minutes',
    '15',
    'Default operational grace period after scheduled pickup time before an '
    'uncollected order may be handled per no-show policy. Restaurant-level '
    'override lives on restaurants.grace_period_minutes. SRS §2.'
  )
on conflict (key) do nothing;

insert into feature_flags (key, enabled, description) values
  ('multi_restaurant_ordering', true, 'One checkout spanning multiple restaurant orders. SRS §9.'),
  ('ratings', true, 'Customer 1-5 star ratings for eligible completed orders. SRS §9.'),
  ('announcements', true, 'Super Admin customer-facing announcements. SRS V2 §O.'),
  ('optional_quantity_inventory', true, 'Vendor-opt-in quantity-based stock. SRS V2 §M.'),
  ('promotions', false, 'Coupons/discounts — reserved architecture only, NOT active in V1. SRS V2 §N.')
on conflict (key) do nothing;

insert into maintenance_mode (key, is_active, message) values
  ('global', false, null)
on conflict (key) do nothing;
