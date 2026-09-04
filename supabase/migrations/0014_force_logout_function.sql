-- UNI8 — Developer 2, Phase 4 (Vendor Admin Operations)
-- 0014_force_logout_function.sql
--
-- supabase-js's `auth.admin.signOut(jwt, scope)` takes a session's JWT
-- access token, NOT a user id — there is no direct "kill every session
-- for this user id" call in the Admin API. The only real mechanism
-- (confirmed against Supabase's own documented internal Logout behavior:
-- "Logout deletes all refresh tokens for a user from auth.refresh_tokens")
-- is deleting that user's rows from auth.refresh_tokens directly, which
-- blocks every existing session from refreshing past its current short-
-- lived access token. This is exactly the mechanism Supabase's own
-- signOut() uses internally — this function just makes it callable for a
-- specific target user id from a service-role Server Action, which the
-- JS SDK doesn't expose a method for.
--
-- Schema checked directly against this live project before writing this
-- (auth.refresh_tokens.user_id is `character varying`, not `uuid` — hence
-- the cast; auth.sessions.user_id is `uuid`, with a `not_after` expiry
-- column that's cleared here too for cleanliness, though the
-- refresh_tokens deletion alone is what actually blocks continued access).
--
-- SECURITY DEFINER so it can act on the `auth` schema from a caller that
-- only has `public`-schema grants — and EXECUTE is revoked from
-- public/anon/authenticated immediately after, matching
-- 0012_security_advisor_hardening.sql's reasoning: a function that can
-- force-logout ANY user by id must never be callable by an arbitrary
-- authenticated user, only by the service-role client (which bypasses
-- grant checks entirely, so the revoke doesn't affect legitimate callers).

create or replace function force_logout_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from auth.refresh_tokens where user_id = target_user_id::text;
  update auth.sessions
    set not_after = now()
    where user_id = target_user_id
      and (not_after is null or not_after > now());
end;
$$;

revoke execute on function force_logout_user(uuid) from public, anon, authenticated;
