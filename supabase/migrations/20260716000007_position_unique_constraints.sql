-- ============================================================
-- TASK-58 slice 2b: deferrable UNIQUE on the single-scope position tables.
-- Advisor-approved (Fable, 2026-07-16).
--
-- custom_statuses / swimlanes / epics number positions within a project, and
-- tasks within a story — one flat scope each, so a UNIQUE(scope, position) is
-- both expressible and true. stories and backlog_dividers are excluded: their
-- position is scoped by zone (backlog = iteration_id is null and state <>
-- 'unscheduled', plus per-iteration / per-status / per-swimlane zones) and two
-- tables share one backlog order space, so no single-column UNIQUE holds.
--
-- DEFERRABLE INITIALLY DEFERRED because the rewrites (swap_adjacent, and the
-- per-scope resequence below) move several rows through positions that collide
-- mid-statement and only reconcile at commit.
--
-- Existing duplicates must go first or the ADD CONSTRAINT fails: promote left
-- every promoted epic at position 0 (fixed for new rows in 20260716000005 but
-- not retroactively), and the old max+1 races could tie any of these scopes.
-- Resequence each scope by (position, id) — a monotone remap, so it preserves
-- whatever order the rows already had and just closes the ties.
-- ============================================================

-- Per-scope resequence. row_number - 1 gives a dense 0..n-1 with no ties; the
-- (position, id) order keeps the existing sequence and breaks ties
-- deterministically. Only rows whose position actually changes are written.
update public.custom_statuses s
  set position = r.rn
  from (
    select id, row_number() over (partition by project_id order by position, id) - 1 as rn
    from public.custom_statuses
  ) r
  where s.id = r.id and s.position is distinct from r.rn;

update public.swimlanes s
  set position = r.rn
  from (
    select id, row_number() over (partition by project_id order by position, id) - 1 as rn
    from public.swimlanes
  ) r
  where s.id = r.id and s.position is distinct from r.rn;

update public.epics s
  set position = r.rn
  from (
    select id, row_number() over (partition by project_id order by position, id) - 1 as rn
    from public.epics
  ) r
  where s.id = r.id and s.position is distinct from r.rn;

update public.tasks s
  set position = r.rn
  from (
    select id, row_number() over (partition by story_id order by position, id) - 1 as rn
    from public.tasks
  ) r
  where s.id = r.id and s.position is distinct from r.rn;

alter table public.custom_statuses
  add constraint custom_statuses_project_position_uk
  unique (project_id, position) deferrable initially deferred;

alter table public.swimlanes
  add constraint swimlanes_project_position_uk
  unique (project_id, position) deferrable initially deferred;

alter table public.epics
  add constraint epics_project_position_uk
  unique (project_id, position) deferrable initially deferred;

alter table public.tasks
  add constraint tasks_story_position_uk
  unique (story_id, position) deferrable initially deferred;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- alter table public.custom_statuses drop constraint custom_statuses_project_position_uk;
-- alter table public.swimlanes drop constraint swimlanes_project_position_uk;
-- alter table public.epics drop constraint epics_project_position_uk;
-- alter table public.tasks drop constraint tasks_story_position_uk;
