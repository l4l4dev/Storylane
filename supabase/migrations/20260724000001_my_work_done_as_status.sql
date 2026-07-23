-- My Work: Done becomes an exclusive status column, not an append-only log
-- (owner decision 2026-07-24, supersedes doc-14/doc-15's additive-log design).
-- A story whose state category is `done` now belongs in Done and nowhere else;
-- the separate story_completions log is no longer read or written.
--
-- This migration is deliberately NON-destructive: story_completions, its RLS
-- policies, and the stories SELECT OR-clause that reads it all stay in place so
-- no production completion data is lost on merge (deploy.yml applies migrations
-- to production unconditionally). Dropping the now-orphaned table + policies is
-- deferred to TASK-98's baseline squash + production reset.

-- ------------------------------------------------------------
-- Stop logging completions. maintain_story_completed_at keeps maintaining
-- stories.completed_at exactly as before (Done groups by it, and the retention
-- window filters on it), but no longer inserts a story_completions row — Done
-- membership is now read straight from the story's own done category, so the
-- log has no reader left. Still SECURITY DEFINER and search_path-pinned to
-- match the established pattern for this function.
-- ------------------------------------------------------------
create or replace function public.maintain_story_completed_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_category text;
  v_new_category text;
begin
  if tg_op = 'UPDATE' and new.state_id is not distinct from old.state_id then
    new.completed_at := old.completed_at;
    return new;
  end if;

  if new.state_id is not null then
    select category into v_new_category from public.project_states where id = new.state_id;
  end if;

  if tg_op = 'UPDATE' and old.state_id is not null then
    select category into v_old_category from public.project_states where id = old.state_id;
  end if;

  if v_new_category = 'done' then
    -- done-to-done preserves the original timestamp; a fresh entry into done
    -- stamps now(). No story_completions insert any more (Done reads the
    -- story's live done category directly).
    if v_old_category = 'done' then
      new.completed_at := old.completed_at;
    else
      new.completed_at := now();
    end if;
  else
    new.completed_at := null;
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------
-- done_position — the viewer's manual card order within Done (owner request:
-- Done cards land where dropped, not forced to completed_at order). Unlike
-- today_position / column_position, Done membership is NOT a local field on
-- this row (it's the story's own done category), so there is no discriminator
-- to hang a CHECK constraint or reset trigger on — a stale done_position on a
-- row that has since left Done is simply never read (classification only reads
-- it for rows whose story is currently done). setMyWorkColumn clears it
-- alongside the other position fields when a card is placed in an active
-- column, so a card re-completed later starts unordered rather than inheriting
-- a stale slot.
-- ------------------------------------------------------------
alter table public.my_work_story_state
  add column done_position int;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- alter table public.my_work_story_state drop column done_position;
-- (restore maintain_story_completed_at from 20260722000002 — the version that
--  inserts into story_completions on a fresh done transition)
