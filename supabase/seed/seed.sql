-- UNI8 — Local/staging development seed data.
-- NOT for production. Run via: npm run db:seed (see package.json).
-- Auth users (super admin / vendor admin / staff test accounts) are NOT
-- created here — Supabase Auth users must be created through the Auth
-- Admin API, not raw SQL. See scripts/seed-auth-users.ts.

insert into restaurants (id, name, slug, status, description, preparation_default_minutes, grace_period_minutes)
values
  ('00000000-0000-0000-0000-000000000101', 'Campus Grill', 'campus-grill', 'active', 'Burgers, wraps and fries.', 10, 15),
  ('00000000-0000-0000-0000-000000000102', 'Chai Point Express', 'chai-point-express', 'active', 'Chai, coffee and quick snacks.', 5, 10)
on conflict (id) do nothing;

insert into product_categories (id, restaurant_id, name, sort_order) values
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101', 'Burgers', 1),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000101', 'Sides', 2),
  ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000102', 'Beverages', 1)
on conflict (id) do nothing;

insert into products (restaurant_id, category_id, name, description, price_paise, cook_time_minutes, availability) values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000201', 'Classic Veg Burger', 'House patty, lettuce, mayo.', 12000, 8, 'available'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000201', 'Double Cheese Burger', 'Two patties, double cheese.', 18000, 10, 'available'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000202', 'Peri Peri Fries', 'Crispy fries, peri peri masala.', 8000, 6, 'available'),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000203', 'Masala Chai', 'Classic spiced tea.', 2000, 3, 'available')
on conflict do nothing;

insert into walking_times (restaurant_from_id, restaurant_to_id, minutes) values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000102', 4),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000101', 4)
on conflict do nothing;

-- Open every day, 08:00–22:00 campus-local — without this, Phase 2's
-- feasibility check (lib/scheduling/hours.ts) reports every pickup time as
-- "restaurant_closed" for these seed restaurants, since resolveOpenWindow
-- returns null (closed) whenever no restaurant_hours row exists for a
-- given day. Both restaurants get the same simple schedule for local dev.
insert into restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
select r.id, d.day_of_week, '08:00:00', '22:00:00', false
from (values
  ('00000000-0000-0000-0000-000000000101'::uuid),
  ('00000000-0000-0000-0000-000000000102'::uuid)
) as r(id)
cross join (values (0),(1),(2),(3),(4),(5),(6)) as d(day_of_week)
on conflict (restaurant_id, day_of_week) do nothing;
