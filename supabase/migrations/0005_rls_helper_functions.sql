-- UNI8 — Phase 1 Foundation
-- 0005_rls_helper_functions.sql
--
-- SECURITY DEFINER helper functions used by RLS policies. These run with
-- the privileges of the function owner (bypassing RLS internally), which is
-- what lets a policy on `profiles` check a user's own role without causing
-- infinite RLS recursion. This is the standard Supabase pattern for
-- role/membership checks. See SRS §3/§17: "Authorization... RBAC +
-- restaurant-scoped access + PostgreSQL RLS. Server-side authorization
-- checks are mandatory."
--
-- IMPORTANT: these functions must stay tiny and read-only. Never put
-- business logic that mutates data in a SECURITY DEFINER function that RLS
-- policies call on every row-read — keep them cheap.

create or replace function current_app_role()
returns app_role
language sql
security definer
set search_path = public
stable
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_super_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and role = 'super_admin'
      and status = 'active'
  );
$$;

create or replace function is_active_vendor_admin_for(target_restaurant_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from vendor_admin_memberships vam
    join profiles p on p.id = vam.user_id
    where vam.user_id = auth.uid()
      and vam.restaurant_id = target_restaurant_id
      and vam.disabled_at is null
      and p.status = 'active'
  );
$$;

create or replace function is_active_staff_for(target_restaurant_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from restaurant_staff rs
    join profiles p on p.id = rs.user_id
    where rs.user_id = auth.uid()
      and rs.restaurant_id = target_restaurant_id
      and rs.disabled_at is null
      and p.status = 'active'
  );
$$;

-- Restaurant IDs the current user has ANY operational scope over
-- (vendor admin OR staff). Used to scope order/product/etc. queries.
create or replace function my_restaurant_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select restaurant_id from vendor_admin_memberships
    where user_id = auth.uid() and disabled_at is null
  union
  select restaurant_id from restaurant_staff
    where user_id = auth.uid() and disabled_at is null;
$$;
