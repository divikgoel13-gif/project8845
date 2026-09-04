-- UNI8 — Developer 3, Phase 7 (SRS V2.6 §60 restaurant states)
-- 0020_v26_enum_additions.sql
--
-- This migration contains NOTHING but enum value additions, and that is
-- deliberate.
--
-- SRS V2.6 §60 states the restaurant states explicitly: "Restaurant states are
-- explicitly Open, Paused, Closed and Archived." The Phase 1 `restaurant_status`
-- enum has 'active', 'paused' and 'archived' — 'active' is §60's "Open", so the
-- only genuinely missing state is 'closed'.
--
-- PostgreSQL permits `alter type ... add value` inside a transaction block from
-- v12, but the newly added label may NOT be referenced later in that same
-- transaction. The Supabase CLI wraps each migration file in one transaction, so
-- adding the label and then using it (in a check constraint, a backfill, or an
-- index predicate) in a single file would fail at apply time with
-- "unsafe use of new value of enum type". Splitting the label addition into its
-- own file is the standard remedy: 0021 is free to use 'closed'.
--
-- Nothing about existing rows changes. 'closed' is opt-in, set by an explicit
-- audited Super Admin action.

alter type restaurant_status add value if not exists 'closed' after 'paused';

-- SRS V2.6 §29: "Every restaurant must be explicitly classified by Super Admin
-- as Inside University or Outside University." A new type rather than a boolean
-- because §29.1 specifies a "required Restaurant Location Type dropdown" with
-- exactly those two allowed values, and because a boolean named
-- `is_inside_university` reads ambiguously in queries where it is null.
--
-- Created here (not in 0021) purely for locality with the enum change above;
-- a freshly CREATED type has no in-transaction usage restriction, so 0021 may
-- reference it.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'restaurant_location_type') then
    create type restaurant_location_type as enum (
      'inside_university',
      'outside_university'
    );
  end if;
end
$$;
