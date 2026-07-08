-- ============================================================
-- Task 4: Rename workflow_mode 'pivotal' -> 'tracker' (2026-07-08).
--
-- The name "Pivotal Tracker" must never appear in the product UI; the
-- iteration/velocity workflow mode is now called "Tracker" everywhere
-- (see spec/features.md, spec/data-model.md). This migration updates
-- existing rows and the CHECK constraint in one step.
-- ============================================================

alter table public.projects
  drop constraint projects_workflow_mode_check;

update public.projects set workflow_mode = 'tracker' where workflow_mode = 'pivotal';

alter table public.projects
  alter column workflow_mode set default 'tracker';

alter table public.projects
  add constraint projects_workflow_mode_check
  check (workflow_mode in ('tracker', 'free'));

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- alter table public.projects drop constraint projects_workflow_mode_check;
-- alter table public.projects alter column workflow_mode set default 'pivotal';
-- alter table public.projects add constraint projects_workflow_mode_check
--   check (workflow_mode in ('pivotal', 'free'));
-- update public.projects set workflow_mode = 'pivotal' where workflow_mode = 'tracker';
