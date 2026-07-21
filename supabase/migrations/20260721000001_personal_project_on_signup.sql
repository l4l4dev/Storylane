-- ============================================================
-- TASK-93 (doc-8 §4, owner decision 2026-07-18): auto-create a personal
-- project at signup — 1-day cadence, minimal state template, "My Tasks" —
-- so a solo user has somewhere to work with zero setup and My Work isn't
-- empty on first login.
--
-- Advisor design note (2026-07-20, corrected 2026-07-21): the original plan
-- called for extracting a shared seed_project() SECURITY DEFINER function to
-- reuse the create_project RPC's seeding logic. That premise was stale —
-- create_project was already dropped in 20260718000001_remove_free_mode.sql
-- and never recreated; the web client's createProject
-- (apps/web/app/dashboard/actions.ts) does a plain `projects` insert and
-- relies entirely on the two existing AFTER INSERT triggers below, neither
-- of which reads auth.uid():
--   - handle_new_project (20260627000002_projects.sql): enrolls
--     new.created_by as owner
--   - handle_new_project_states (20260719000006_stories_state_id.sql):
--     seeds project_states from new.state_template
-- Since both already key off NEW's own columns, one INSERT here is enough —
-- no new function to extract for a single caller (YAGNI).
--
-- created_by must be set explicitly to new.id: handle_new_user runs in the
-- auth-service trigger context, where auth.uid() does not resolve to the
-- new user, so the column's `default auth.uid()` would fail the
-- `created_by = auth.uid()` INSERT policy — moot anyway, since this
-- function is SECURITY DEFINER and already bypasses RLS to insert into
-- profiles the same way. iteration_length and state_template are passed
-- explicitly because their column defaults (14, 'classic') are wrong for
-- this project, not because they're required.
--
-- No ON CONFLICT / guard against re-running: auth.users rows are never
-- re-inserted for the same id, so this trigger body runs exactly once per
-- real signup. Seeding stays in the same transaction as the profiles
-- insert and auth.users itself — a failure here rolls back the whole
-- signup rather than leaving a user without their personal project
-- (deliberate: doc-8 §4 "no team project" promise must hold from the first
-- login, not eventually).
--
-- Personal project is a NORMAL project — no flag column, invites allowed,
-- no special-casing anywhere. My Work's accent keys off iteration_length=1,
-- not a flag.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
begin
  v_display_name := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    split_part(coalesce(new.email, 'user'), '@', 1)
  );

  insert into public.profiles (id, display_name, username, avatar_url)
  values (
    new.id,
    v_display_name,
    public.generate_username(v_display_name),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.projects (name, iteration_length, state_template, created_by)
  values ('My Tasks', 1, 'minimal', new.id);

  return new;
end;
$$;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- (restore handle_new_user from 20260702000001_username_activity_triggers.sql,
--  dropping the projects insert)
