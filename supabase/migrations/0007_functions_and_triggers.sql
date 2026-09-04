-- UNI8 — Phase 1 Foundation
-- 0007_functions_and_triggers.sql

-- ─────────────────────────────────────────────────────────────────────────
-- Generic updated_at maintenance
-- ─────────────────────────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at before update on profiles
  for each row execute function set_updated_at();
create trigger trg_carts_updated_at before update on carts
  for each row execute function set_updated_at();
create trigger trg_orders_updated_at before update on orders
  for each row execute function set_updated_at();
create trigger trg_payments_updated_at before update on payments
  for each row execute function set_updated_at();
create trigger trg_refund_events_updated_at before update on refund_events
  for each row execute function set_updated_at();
create trigger trg_grievance_tickets_updated_at before update on grievance_tickets
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- Enforce "maximum 5 active staff per restaurant" (SRS §4, §11) at the
-- database level, not just in the UI — this must hold even if a future
-- code path forgets to check it.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function enforce_staff_limit()
returns trigger
language plpgsql
as $$
declare
  active_count integer;
begin
  if new.disabled_at is null then
    select count(*) into active_count
    from restaurant_staff
    where restaurant_id = new.restaurant_id
      and disabled_at is null
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

    if active_count >= 5 then
      raise exception 'restaurant % already has 5 active staff (max per SRS §11)', new.restaurant_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_enforce_staff_limit
  before insert or update on restaurant_staff
  for each row execute function enforce_staff_limit();

-- ─────────────────────────────────────────────────────────────────────────
-- Defense-in-depth: block any client attempt to change profiles.role or
-- profiles.status via the self-update policy. Role/status changes must go
-- through server actions using the service-role client (audited).
-- The RLS policy `profiles_update_self` already allows any authenticated
-- user to update their own row (for name/email/course edits); this trigger
-- closes the privilege-escalation gap that policy alone would leave open.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function prevent_self_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role is distinct from old.role or new.status is distinct from old.status)
     and not is_super_admin() then
    raise exception 'role/status changes must be performed by a Super Admin action'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger trg_prevent_self_role_escalation
  before update on profiles
  for each row execute function prevent_self_role_escalation();
