-- My Work: Todo cards get a persisted manual order (owner request: Todo cards
-- land where dropped instead of snapping back to raw board/backlog order).
-- Mirrors today_position / column_position — a nullable position that only
-- means anything while the row actually classifies to Todo (no Today date, no
-- free column).

alter table public.my_work_story_state
  add column todo_position int;

-- Todo is "no Today date AND no free column" — so todo_position is only valid
-- then. Same guard shape as today_position_needs_date / column_position_needs_
-- column.
alter table public.my_work_story_state
  add constraint my_work_story_state_todo_position_needs_todo
    check (todo_position is null or (today_date is null and column_id is null));

-- Fold the reset into a single positions trigger, replacing the column_position-
-- only one (20260722000015). A BEFORE UPDATE reset — not just app-side field
-- nulling — is what keeps the paired-field invariant honest for every write
-- path (TASK-161 was exactly an app path forgetting to clear a paired field):
--   - column_position dies when the row leaves its free column (column_id nulls
--     or changes) — covers the free-column FK's own SET NULL cascade too.
--   - todo_position dies the moment the row gains a Today date or a free column
--     (i.e. stops classifying to Todo).
create or replace function public.my_work_story_state_reset_positions()
returns trigger
language plpgsql
as $$
begin
  if new.column_id is null or new.column_id is distinct from old.column_id then
    new.column_position := null;
  end if;
  if new.today_date is not null or new.column_id is not null then
    new.todo_position := null;
  end if;
  return new;
end;
$$;

revoke execute on function public.my_work_story_state_reset_positions() from public, anon, authenticated;

drop trigger my_work_story_state_reset_column_position on public.my_work_story_state;
create trigger my_work_story_state_reset_positions
  before update on public.my_work_story_state
  for each row
  execute function public.my_work_story_state_reset_positions();

-- The old single-purpose function is now unreferenced.
drop function public.my_work_story_state_reset_column_position();

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop trigger my_work_story_state_reset_positions on public.my_work_story_state;
-- drop function public.my_work_story_state_reset_positions();
-- (restore my_work_story_state_reset_column_position + its trigger from 20260722000015)
-- alter table public.my_work_story_state
--   drop constraint my_work_story_state_todo_position_needs_todo;
-- alter table public.my_work_story_state drop column todo_position;
