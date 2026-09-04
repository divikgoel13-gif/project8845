-- UNI8 — Phase 1 Foundation
-- 0009_handle_new_auth_user.sql
--
-- Every Supabase Auth user (customer via phone OTP, or vendor/staff/admin
-- via email+password) needs a matching `profiles` row. Rather than trusting
-- every signup code path to remember to create one, a trigger on
-- auth.users guarantees it. Default role is 'customer' — elevated roles
-- (vendor_admin/staff/super_admin) are granted explicitly afterward via a
-- Super Admin action (SRS §8), never self-assigned at signup.

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, phone, email, role, status)
  values (
    new.id,
    new.phone,
    new.email,
    'customer',
    'active'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger trg_handle_new_auth_user
  after insert on auth.users
  for each row execute function handle_new_auth_user();
