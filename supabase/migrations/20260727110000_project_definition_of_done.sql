-- TASK-206: per-project Definition of Done, a free-text reference checklist
-- shown alongside a story's transition into a done-category state. No new
-- RLS policy: this rides the projects table's existing owner-only UPDATE
-- policy ("owners can update projects", 20260627000002_projects.sql), the
-- same one name/description/iteration_term already use — members already
-- read the whole row via "members can view their projects".

alter table public.projects
  add column definition_of_done text;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- alter table public.projects drop column definition_of_done;
