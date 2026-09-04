-- UNI8 — Developer 2, Phase-Gate hardening
-- 0012_security_advisor_hardening.sql
--
-- Fixes two real findings from Supabase's live security advisor
-- (docs/PHASE_GATE_ACCEPTANCE_RECORD_1.md), run against this project after
-- migrations 0001-0011 were applied. Two other WARN-level findings
-- (RLS helper functions being anon/authenticated-executable; `citext` in
-- the public schema) are intentionally left as-is — see the acceptance
-- record for why.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Mutable search_path on trigger functions (function_search_path_mutable).
-- 0005_rls_helper_functions.sql's functions already pin `search_path`;
-- these three trigger functions from 0007/0011 did not. A mutable
-- search_path on a function invoked implicitly by DML (rather than by an
-- explicit qualified call) is the classic vector for a search_path
-- injection attack. Pin all three to match the existing pattern.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function enforce_staff_limit()
returns trigger
language plpgsql
set search_path = public
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

create or replace function enforce_order_status_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
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

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Public-executable SECURITY DEFINER trigger functions
-- (anon_security_definer_function_executable /
-- authenticated_security_definer_function_executable).
--
-- handle_new_auth_user() and prevent_self_role_escalation() both
-- `returns trigger` and reference NEW/OLD, which only exist inside a
-- trigger firing — they are never meant to be called directly via
-- PostgREST's auto-exposed /rest/v1/rpc/<fn> endpoint. Trigger firing
-- itself does not require the DML-issuing role to hold EXECUTE on the
-- function, so revoking public EXECUTE here closes an unnecessary
-- SECURITY DEFINER attack surface without affecting the triggers that
-- legitimately invoke them (trg_handle_new_auth_user,
-- trg_prevent_self_role_escalation — both already created in 0007/0009).
--
-- Deliberately NOT applied to current_app_role / is_super_admin /
-- is_active_vendor_admin_for / is_active_staff_for / my_restaurant_ids:
-- those ARE meant to be evaluated for the querying anon/authenticated
-- role, because RLS policies call them in the context of that role.
-- Revoking EXECUTE there would silently break RLS enforcement — a worse
-- outcome than the advisor's WARN.
-- ─────────────────────────────────────────────────────────────────────────
revoke execute on function handle_new_auth_user() from public, anon, authenticated;
revoke execute on function prevent_self_role_escalation() from public, anon, authenticated;
