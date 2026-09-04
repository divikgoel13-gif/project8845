-- UNI8 — Phase 3 (Razorpay, Orders & QR Pickup)
-- 0011_order_state_machine_trigger.sql
--
-- Database-level mirror of lib/orders/state-machine.ts's
-- ORDER_STATUS_TRANSITIONS table. This is intentional duplication —
-- defense in depth, the same philosophy as the three independent
-- authorization layers documented in docs/ARCHITECTURE.md. Even though
-- only server-side code using the service-role client can write to
-- `orders` at all (no client-writable RLS policy — see
-- 0006_rls_policies.sql), this trigger protects against a FUTURE bug in
-- that server-side code attempting an invalid transition, since triggers
-- fire regardless of which Postgres role performs the UPDATE.
--
-- If you change this, change lib/orders/state-machine.ts's
-- ORDER_STATUS_TRANSITIONS to match, and vice versa.

create or replace function enforce_order_status_transition()
returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then
    return new; -- non-status field update (e.g. cancel_reason text edit) — allowed
  end if;

  if not (
    case old.status
      when 'payment_pending' then new.status in ('paid', 'cancelled')
      when 'paid' then new.status in ('scheduled')
      when 'scheduled' then new.status in ('preparing', 'cancelled', 'no_show')
      when 'preparing' then new.status in ('ready_for_pickup', 'cancelled')
      when 'ready_for_pickup' then new.status in ('collected', 'no_show', 'cancelled')
      when 'collected' then false
      when 'cancelled' then new.status in ('refund_pending')
      when 'refund_pending' then new.status in ('refunded')
      when 'refunded' then false
      when 'no_show' then false
      else false
    end
  ) then
    raise exception 'invalid order status transition: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_enforce_order_status_transition
  before update on orders
  for each row execute function enforce_order_status_transition();

-- Capacity fix: a 'payment_pending' order (Razorpay order created,
-- payment not yet confirmed) must NOT hold a pickup-slot capacity spot
-- indefinitely — an abandoned checkout would otherwise permanently
-- consume a slot. lib/scheduling/capacity.ts's countOrdersInSlot query
-- already excludes payment_pending explicitly in its `.not(...)` filter;
-- this replaces the Phase 2 partial index so it stays a true superset of
-- what that query actually scans (the old index only excluded
-- cancelled/refunded/no_show, which still included payment_pending —
-- functionally harmless since Postgres would just do extra filtering,
-- but wasteful and worth fixing now that the real query shape is settled).
drop index if exists idx_orders_restaurant_pickup_time_active;

create index idx_orders_restaurant_pickup_time_active on orders (restaurant_id, pickup_time)
  where status not in ('payment_pending', 'cancelled', 'refunded', 'no_show');
