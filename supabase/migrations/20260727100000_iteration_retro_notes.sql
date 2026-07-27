-- TASK-205: retrospective notes, the backward-looking counterpart to the
-- existing forward-looking iterations.goal. No RLS change: the existing
-- "members can view/update iterations" policies (20260627000004_iterations.sql)
-- already gate this column the same way (any member reads, owner/member writes).

alter table public.iterations
  add column retro_notes text;
