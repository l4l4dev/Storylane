-- ============================================================
-- TASK-25 (follow-up from TASK-7 PR #2 fable-advisor review): projects.velocity_window
-- had no CHECK constraint, so 0/negative values were accepted by both
-- createProject and updateProject. A 0 (or negative) velocity_window makes
-- calculateVelocity's window slice permanently empty, so velocity always
-- reports 0 regardless of actual completed-iteration history.
--
-- Only a lower bound is enforced (>= 1) — spec/data-model.md documents no
-- upper bound for this field, and inventing one here would be a product
-- decision this migration isn't positioned to make.
-- ============================================================

alter table public.projects
  add constraint projects_velocity_window_check check (velocity_window >= 1);

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- alter table public.projects drop constraint projects_velocity_window_check;
