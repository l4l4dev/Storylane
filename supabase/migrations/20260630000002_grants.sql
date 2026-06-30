-- ============================================================
-- Table-level privileges for the API role.
-- RLS governs *which rows* are accessible; PostgREST still needs the
-- base DML privileges granted to the `authenticated` role. TRUNCATE is
-- intentionally NOT granted (it bypasses RLS).
-- ============================================================

grant usage on schema public to authenticated;

grant select, insert, update, delete
  on all tables in schema public to authenticated;
grant usage, select
  on all sequences in schema public to authenticated;
grant execute
  on all functions in schema public to authenticated;

-- Apply the same defaults to objects created by future migrations.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
alter default privileges in schema public
  grant execute on functions to authenticated;
