-- ============================================================
-- TASK-137 (doc-14 round-5 addendum, owner decision 2026-07-22): auto-map the
-- personal project's Doing/Done to My Work at creation, and backfill
-- existing personal projects.
--
-- The personal project ("My Tasks") has no reachable Settings page (TASK-103
-- hides it from the switcher/dashboard, TASK-129 routes its "<- Board" link
-- to My Work instead) -- so it can never be mapped by hand via the Settings
-- UI TASK-133 shipped. Without a mapping, personal-task Done would stay a
-- cancellable local mark forever and never enter the permanent Done log
-- (story_completions), defeating My Work's primary use case for the exact
-- project it's most needed for.
--
-- If the mapped states later drift (deleted/recategorized via direct URL or
-- MCP -- the personal project's own board pages still exist, just unlinked),
-- the standard broken-mapping behavior applies unchanged: read-side unmapped
-- classification (my-work/page.tsx's mappedProjectIds) + the My Work banner
-- (my-work-mapping-broken-banner.tsx) -- no personal-specific mechanism.
-- ============================================================

-- Full function replacement (this repo's established convention across this
-- function's prior redefinitions) — based on the CURRENT definition
-- (20260721000004_projects_is_personal.sql), which already added
-- is_personal := true; earlier revisions of this same function (e.g.
-- 20260721000001) are superseded and not the base for this diff.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name    text;
  v_project_id      uuid;
  v_doing_state_id  uuid;
  v_done_state_id   uuid;
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
  values ('My Tasks', 1, 'minimal', new.id, true)
  returning id into v_project_id;

  -- project_states for v_project_id already exist at this point: the AFTER
  -- INSERT ... FOR EACH ROW trigger on_project_created_seed_states
  -- (20260719000006) fires synchronously as part of the INSERT above
  -- completing — Postgres runs a row's AFTER triggers before the statement
  -- that fired them returns control to this function.
  select id into v_doing_state_id from public.project_states
    where project_id = v_project_id and category = 'in_progress'
    order by position asc limit 1;
  select id into v_done_state_id from public.project_states
    where project_id = v_project_id and category = 'done'
    order by position asc limit 1;

  -- Only inserted when both sides resolve — the 'minimal' template always has
  -- exactly one of each, but this stays defensive rather than assuming the
  -- template shape (AC #2 applies the identical skip-don't-error rule below).
  if v_doing_state_id is not null and v_done_state_id is not null then
    insert into public.project_my_work_mapping (project_id, doing_state_id, done_state_id, configured_by)
    values (v_project_id, v_doing_state_id, v_done_state_id, new.id);
  end if;

  return new;
end;
$$;

-- Backfill (TASK-137 AC #2): personal projects created before this migration
-- have no project_my_work_mapping row. Same selection rule as above (first
-- by position within each category); a personal project lacking a matching-
-- category state (e.g. its states were edited away from the minimal
-- template's default shape since creation) is skipped, not errored.
insert into public.project_my_work_mapping (project_id, doing_state_id, done_state_id, configured_by)
select
  p.id,
  (
    select ps.id from public.project_states ps
    where ps.project_id = p.id and ps.category = 'in_progress'
    order by ps.position asc limit 1
  ),
  (
    select ps.id from public.project_states ps
    where ps.project_id = p.id and ps.category = 'done'
    order by ps.position asc limit 1
  ),
  p.created_by
from public.projects p
where p.is_personal
  and not exists (select 1 from public.project_my_work_mapping m where m.project_id = p.id)
  and exists (select 1 from public.project_states ps where ps.project_id = p.id and ps.category = 'in_progress')
  and exists (select 1 from public.project_states ps where ps.project_id = p.id and ps.category = 'done');

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- delete from public.project_my_work_mapping
--   where configured_by in (select created_by from public.projects where is_personal)
--   and project_id in (select id from public.projects where is_personal);
-- (restore handle_new_user from 20260721000004_projects_is_personal.sql)
