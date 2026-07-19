-- ============================================================
-- TASK-91: log_story_activity re-anchored from stories.state (dropped) to
-- stories.state_id. The activity payload stores state NAMES (resolved via
-- project_states), not raw ids, so activity history stays readable if a
-- state is later renamed or deleted — matching state_changed's prior
-- literal-name convention. Word-for-word from the current body
-- (20260718000001) otherwise.
-- ============================================================

create or replace function public.log_story_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_name text;
  v_new_name text;
begin
  if tg_op = 'INSERT' then
    insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
    values (
      new.project_id, new.id, coalesce(auth.uid(), new.created_by),
      'story.created', jsonb_build_object('title', new.title)
    );
  elsif tg_op = 'UPDATE' and new.state_id is distinct from old.state_id then
    if old.state_id is not null then
      select name into v_old_name from public.project_states where id = old.state_id;
    end if;
    if new.state_id is not null then
      select name into v_new_name from public.project_states where id = new.state_id;
    end if;
    insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
    values (
      new.project_id, new.id, coalesce(auth.uid(), new.created_by),
      'story.state_changed', jsonb_build_object('from', v_old_name, 'to', v_new_name)
    );
  end if;
  return new;
end;
$$;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- (restore log_story_activity from 20260718000001_remove_free_mode.sql —
-- references the dropped stories.state column and cannot run as-is)
