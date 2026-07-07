-- ============================================================
-- Table-level privileges for the service role (Task 12).
-- 20260630000002_grants.sql granted DML to `authenticated` only, so
-- service-role clients (the git-webhook Edge Function, lib/supabase/
-- admin.ts) hit "permission denied" despite bypassing RLS — BYPASSRLS
-- doesn't waive base table grants. Same DML-only convention as the
-- authenticated grants: TRUNCATE intentionally NOT granted.
-- ============================================================

grant usage on schema public to service_role;

grant select, insert, update, delete
  on all tables in schema public to service_role;
grant usage, select
  on all sequences in schema public to service_role;
grant execute
  on all functions in schema public to service_role;

-- Apply the same defaults to objects created by future migrations.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
alter default privileges in schema public
  grant execute on functions to service_role;
