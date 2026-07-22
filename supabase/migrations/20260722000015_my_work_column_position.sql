-- Free-column manual card order (doc-17 finding #8): generalizes
-- today_position to any free column, so dragging a card within e.g. "Doing"
-- persists instead of silently reverting on refresh.

alter table public.my_work_story_state
  add column column_position int;

alter table public.my_work_story_state
  add constraint my_work_story_state_column_position_needs_column
    check (column_position is null or column_id is not null);

-- The column_fk's own SET NULL (20260722000007) only names column_id (PG's
-- column-list SET NULL can only null columns that are themselves part of the
-- FK, so column_position can't be added to that list). Deleting a free column
-- would otherwise null column_id via the FK while leaving a reordered card's
-- column_position set, violating the check above and failing the delete
-- outright. A BEFORE UPDATE trigger closes this for every path, not just the
-- FK cascade: whenever column_id ends up
-- null or changes to a different column, column_position is reset with it —
-- covering the FK's own internal UPDATE on column delete, and standing as a
-- backstop for any app code path that forgets to reset it explicitly.
create or replace function public.my_work_story_state_reset_column_position()
returns trigger
language plpgsql
as $$
begin
  if new.column_id is null or new.column_id is distinct from old.column_id then
    new.column_position := null;
  end if;
  return new;
end;
$$;

create trigger my_work_story_state_reset_column_position
  before update on public.my_work_story_state
  for each row
  execute function public.my_work_story_state_reset_column_position();

-- Trigger functions are invoked internally, never called directly — Postgres
-- still grants EXECUTE to PUBLIC by default on CREATE, so this needs the same
-- explicit revoke every other function here has (grant-lockdown.integration.test.ts).
revoke execute on function public.my_work_story_state_reset_column_position() from public, anon, authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop trigger my_work_story_state_reset_column_position on public.my_work_story_state;
-- drop function public.my_work_story_state_reset_column_position();
-- alter table public.my_work_story_state
--   drop constraint my_work_story_state_column_position_needs_column;
-- alter table public.my_work_story_state
--   drop column column_position;
