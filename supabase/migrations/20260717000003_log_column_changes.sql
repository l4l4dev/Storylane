-- ============================================================
-- TASK-40: record free-mode column moves in activity_logs.
--
-- log_story_activity (20260702000001) logs INSERT ('story.created') and state
-- transitions ('story.state_changed'), but free-mode boards drive the column
-- via stories.custom_status_id, not state — so moving a card between columns
-- was invisible to the activity log and to the story's history section.
--
-- Extend the single recording path (ARCHITECTURE.md: clients never insert
-- activity_logs directly) to also emit 'story.column_changed' when
-- custom_status_id changes. Re-created verbatim from 20260702000001 apart from
-- the UPDATE branch, which now checks state and custom_status_id independently
-- (a single UPDATE could in principle change both; in practice tracker moves
-- touch only state and free moves only custom_status_id, so they don't
-- double-fire).
--
-- The payload stores the column NAMES resolved at move time, not the ids —
-- mirroring state_changed's literal from/to values, so the history stays
-- readable after a column is renamed or deleted. A null custom_status_id (a
-- story with no column, rendered in the leftmost per spec/screens.md) is stored
-- as null and rendered as "no column" by describeActivity.
-- ============================================================

create or replace function public.log_story_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
    values (
      new.project_id, new.id, coalesce(auth.uid(), new.created_by),
      'story.created', jsonb_build_object('title', new.title)
    );
  elsif tg_op = 'UPDATE' then
    if new.state is distinct from old.state then
      insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
      values (
        new.project_id, new.id, coalesce(auth.uid(), new.created_by),
        'story.state_changed', jsonb_build_object('from', old.state, 'to', new.state)
      );
    end if;

    if new.custom_status_id is distinct from old.custom_status_id then
      insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
      values (
        new.project_id, new.id, coalesce(auth.uid(), new.created_by),
        'story.column_changed',
        jsonb_build_object(
          'from', (select name from public.custom_statuses where id = old.custom_status_id),
          'to', (select name from public.custom_statuses where id = new.custom_status_id)
        )
      );
    end if;
  end if;
  return new;
end;
$$;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- restore log_story_activity from 20260702000001_username_activity_triggers.sql
