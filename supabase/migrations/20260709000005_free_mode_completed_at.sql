-- ============================================================
-- TASK-16.1: Free mode "Done dates" (spec/screens.md "Free mode board" —
-- KanbanFlow parity additions). completed_at now also needs maintaining
-- for free-mode stories, keyed on custom_status_id pointing at an is_done
-- column instead of tracker's state='accepted'.
--
-- Replaces (not adds alongside) the TASK-15 maintain_story_completed_at
-- trigger function body — a second, separately-named trigger keyed on
-- custom_status_id would fire in an unpredictable order relative to the
-- existing state-keyed one (Postgres runs same-event BEFORE triggers in
-- name order), and the tracker branch would win by alphabetical accident,
-- clobbering completed_at back since a free-mode story's `state` never
-- changes from its default. One mode-aware function, still driven by the
-- same two unconditional stories_maintain_completed_at_insert/_update
-- triggers from 20260709000004, is the only way to keep this a single
-- source of truth per row.
-- ============================================================

create or replace function public.maintain_story_completed_at()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_workflow_mode text;
  v_is_done boolean;
begin
  select workflow_mode into v_workflow_mode from public.projects where id = new.project_id;

  if v_workflow_mode = 'free' then
    if tg_op = 'INSERT' or new.custom_status_id is distinct from old.custom_status_id then
      if new.custom_status_id is null then
        v_is_done := false;
      else
        select is_done into v_is_done from public.custom_statuses where id = new.custom_status_id;
      end if;
      new.completed_at := case when coalesce(v_is_done, false) then now() else null end;
    else
      new.completed_at := old.completed_at;
    end if;
  else
    if tg_op = 'INSERT' or new.state is distinct from old.state then
      new.completed_at := case when new.state = 'accepted' then now() else null end;
    else
      new.completed_at := old.completed_at;
    end if;
  end if;

  return new;
end;
$$;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- create or replace function public.maintain_story_completed_at()
-- returns trigger language plpgsql set search_path = public as $$
-- begin
--   if tg_op = 'INSERT' or new.state is distinct from old.state then
--     new.completed_at := case when new.state = 'accepted' then now() else null end;
--   else
--     new.completed_at := old.completed_at;
--   end if;
--   return new;
-- end;
-- $$;
