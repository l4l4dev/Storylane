-- ============================================================
-- Task 12 prerequisite: stories.number — a per-project sequential story
-- number (see spec/data-model.md). Shown as #123 in the UI and referenced
-- as [SL-123] in PR titles so the GitHub/Forgejo webhook can match a PR to
-- a story without exposing UUIDs.
--
-- The number is always assigned by the BEFORE INSERT trigger (any
-- client-supplied value is overwritten, so a tampered insert can't skip
-- ahead or collide). A per-project advisory transaction lock serializes
-- concurrent inserts within one project — max(number)+1 alone would race
-- and trip the unique constraint.
-- ============================================================

alter table public.stories add column number int;

-- Backfill existing rows per project in creation order (id as a stable
-- tiebreak for equal timestamps).
with numbered as (
  select id, row_number() over (partition by project_id order by created_at, id) as rn
  from public.stories
)
update public.stories s
set number = n.rn
from numbered n
where s.id = n.id;

alter table public.stories alter column number set not null;
-- The default is never kept (the trigger below always overwrites it); it
-- exists so inserts don't have to supply a value — PostgREST's generated
-- Insert type would otherwise require `number` from every client.
alter table public.stories alter column number set default 0;
alter table public.stories add constraint stories_project_id_number_key unique (project_id, number);

-- security definer so numbering works regardless of the inserting user's
-- read visibility into other members' stories (same rationale as
-- log_story_activity — see 20260702000001).
create or replace function public.assign_story_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('story_number:' || new.project_id::text));
  select coalesce(max(number), 0) + 1 into new.number
  from public.stories
  where project_id = new.project_id;
  return new;
end;
$$;

create trigger stories_assign_number
  before insert on public.stories
  for each row execute function public.assign_story_number();

-- The number is a permanent external identifier ([SL-123] in PR titles, see
-- spec/integrations.md) — pin it on UPDATE so it can't be silently
-- renumbered out from under an open PR. The story-update RLS policy has no
-- column-level restriction, so without this any member could rewrite it.
create or replace function public.pin_story_number()
returns trigger
language plpgsql
as $$
begin
  new.number := old.number;
  return new;
end;
$$;

create trigger stories_pin_number
  before update on public.stories
  for each row execute function public.pin_story_number();

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop trigger stories_pin_number on public.stories;
-- drop function public.pin_story_number();
-- drop trigger stories_assign_number on public.stories;
-- drop function public.assign_story_number();
-- alter table public.stories drop constraint stories_project_id_number_key;
-- alter table public.stories drop column number;
