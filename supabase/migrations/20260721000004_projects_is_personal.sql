-- ============================================================
-- TASK-103 (doc-11 D1): identify the auto-created "My Tasks" personal project
-- with a real flag so it can be hidden from the projects list + sidebar (its
-- owner works with it through My Work instead), keeping personal tasks and
-- team projects from mixing in the list.
--
-- This reverses doc-8's deliberate "no is_personal flag; key off
-- iteration_length=1" decision. Justified: a 1-day cadence is a legitimate
-- TEAM project too (doc-8 §4), so iteration_length can't distinguish "the
-- user's personal project" from "a 1-day team project" — and the hide-from-
-- list requirement needs exactly that distinction. See TASK-93 (which created
-- the personal project without a flag) and .backlog/docs/doc-11.
-- ============================================================

alter table public.projects
  add column is_personal boolean not null default false;

-- One personal project per owner, enforced at the DB (decision-1: invariants
-- live in the schema, not just the signup trigger). Partial so ordinary
-- (team) projects are unconstrained.
create unique index projects_one_personal_per_owner
  on public.projects (created_by)
  where is_personal;

-- is_personal is set at signup and never changes afterward. A BEFORE UPDATE
-- trigger pins it (rls-security-reviewer, TASK-103): projects has table-level
-- UPDATE for `authenticated` (no column grants), and the UPDATE RLS gate is
-- project_role='owner' — which via invite_member can be a CO-OWNER who is not
-- created_by. Without this pin, such a co-owner could flip is_personal=true on
-- a shared team project, and My Work would then treat that shared project as
-- personal for EVERY member (rolling over its iterations as if personal) — a
-- cross-user side effect, not a cosmetic self-hide. The trigger closes it at
-- the source without per-column grant bookkeeping. INSERT (the signup path) is
-- untouched, so the flag can still only be set at creation.
create or replace function public.protect_projects_is_personal()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.is_personal := old.is_personal;
  return new;
end;
$$;

-- Trigger-body function: never called directly, so EXECUTE is revoked from
-- every client role (the function_grant_lockdown convention — a trigger fires
-- regardless of the invoker's EXECUTE grant).
revoke execute on function public.protect_projects_is_personal() from public, anon, authenticated;

create trigger projects_protect_is_personal
  before update on public.projects
  for each row execute function public.protect_projects_is_personal();

-- Amend handle_new_user (last set in 20260721000001) to flag the personal
-- project. create-or-replace with the current body verbatim plus is_personal
-- — the earlier migration is left untouched.
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

  insert into public.projects (name, iteration_length, state_template, created_by, is_personal)
  values ('My Tasks', 1, 'minimal', new.id, true);

  return new;
end;
$$;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- (restore handle_new_user from 20260721000001_personal_project_on_signup.sql,
--  dropping the is_personal column from its projects insert)
-- drop trigger projects_protect_is_personal on public.projects;
-- drop function public.protect_projects_is_personal();
-- drop index public.projects_one_personal_per_owner;
-- alter table public.projects drop column is_personal;
