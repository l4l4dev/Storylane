-- ============================================================
-- TASK-15: Focus view (tracker mode) — spec/screens.md "Focus view",
-- spec/data-model.md stories.focus / stories.completed_at.
-- ============================================================

alter table public.stories add column focus text check (focus in ('today', 'this_week'));
alter table public.stories add column completed_at timestamptz;

-- completed_at is a system-maintained derived field (like stories.number),
-- not something any client writes directly — a DB trigger keeps it correct
-- regardless of write path (Web today, iOS writing directly to Supabase
-- later — see decision-1 "invariants live in the database"). Set on the
-- transition to 'accepted', cleared whenever state is anything else. The
-- current tracker state machine (story-state.ts) has no transition away
-- from 'accepted', but the invariant is enforced unconditionally rather
-- than assuming that stays true forever. Free-mode stories never change
-- `state` away from its default (custom_status_id drives their column
-- instead — Task 14), so this never fires for them; free mode's own
-- completed_at handling is separate (TASK-16.1).
--
-- The UPDATE trigger fires unconditionally (no WHEN clause) rather than
-- only `when (new.state is distinct from old.state)`: a WHEN-gated version
-- only recomputes completed_at on a state change but lets an UPDATE that
-- sets completed_at directly *without* touching state pass straight
-- through untouched (rls-security-reviewer, 2026-07-09) — the
-- "owners or authors can update stories" policy has no column-level
-- restriction, so any member permitted to edit a story could otherwise
-- backdate/fabricate its completion date. Recomputes on INSERT or a state
-- change; otherwise pins the previous value, the same defense
-- pin_story_number already uses for stories.number.
create or replace function public.maintain_story_completed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.state is distinct from old.state then
    new.completed_at := case when new.state = 'accepted' then now() else null end;
  else
    new.completed_at := old.completed_at;
  end if;
  return new;
end;
$$;

create trigger stories_maintain_completed_at_insert
  before insert on public.stories
  for each row execute function public.maintain_story_completed_at();

create trigger stories_maintain_completed_at_update
  before update on public.stories
  for each row execute function public.maintain_story_completed_at();

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop trigger stories_maintain_completed_at_update on public.stories;
-- drop trigger stories_maintain_completed_at_insert on public.stories;
-- drop function public.maintain_story_completed_at();
-- alter table public.stories drop column completed_at;
-- alter table public.stories drop column focus;
