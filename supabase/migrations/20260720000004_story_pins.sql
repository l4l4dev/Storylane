-- ============================================================
-- TASK-88 (doc-8 §9): story_pins replaces stories.focus.
--
-- The Focus view marked a story as "today" on the story row itself, so one
-- member's plan for the day was written into shared project data and every
-- other member saw it. My Work (TASK-89) is per-user and cross-project, so
-- the mark moves to a per-user table and stories.focus goes away.
-- ============================================================

-- ------------------------------------------------------------
-- story_pins — per-user "surface this in today's My Work" mark.
-- Not project-scoped by column: the story's project is reached through the
-- stories join, which is also what the INSERT policy checks (spec/rls.md).
-- ------------------------------------------------------------
create table public.story_pins (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  story_id   uuid not null references public.stories(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, story_id)
);

-- The PK indexes (user_id, story_id); story_id alone is the lookup the move
-- RPC and the stories cascade both need.
create index story_pins_story_id_idx on public.story_pins (story_id);

alter table public.story_pins enable row level security;

-- No cross-user read path at all: nothing in the product shows another
-- member's pins.
create policy "users view their own pins"
  on public.story_pins for select to authenticated
  using (user_id = auth.uid());

create policy "users pin stories in their own projects"
  on public.story_pins for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.stories s
      where s.id = story_pins.story_id
        and public.is_project_member(s.project_id)
    )
  );

create policy "users delete their own pins"
  on public.story_pins for delete to authenticated
  using (user_id = auth.uid());

-- No UPDATE policy: both columns are the primary key and created_at is a
-- record of when the pin happened. Repinning is delete + insert.

-- ------------------------------------------------------------
-- Drop stories.focus. Pre-launch, so no data migration (locked decision).
-- The CHECK constraint goes with the column.
-- ------------------------------------------------------------

-- move_story_board is the only surviving reader of stories.focus: verbatim
-- from 20260719000008 minus the focus expectation, the focus delta, and the
-- p_view = 'focus' reorder branch. plpgsql resolves column references at
-- execution time, so this must be replaced before the column is dropped or
-- the next call fails instead of the migration.
create or replace function public.move_story_board(
  p_project_id uuid,
  p_item jsonb,
  p_view text,
  p_expected jsonb,
  p_deltas jsonb,
  p_anchor jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_kind text := p_item->>'kind';
  v_id uuid := (p_item->>'id')::uuid;
  v_story record;
  v_current_id uuid;
  v_new_state_id uuid;
  v_state_set boolean;
  v_new_iteration uuid;
  v_zone text;
  v_before_kind text := p_anchor->'before'->>'kind';
  v_before_id uuid := (p_anchor->'before'->>'id')::uuid;
  v_story_ids uuid[];
  v_inserted boolean := false;
  v_pos int;
  i int;
begin
  v_role := public.project_role(p_project_id);
  if v_role is null or v_role not in ('owner', 'member') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('iteration_finalize:' || p_project_id::text));
  perform pg_advisory_xact_lock(hashtext('positions:' || p_project_id::text));

  select id into v_current_id
    from public.iterations
    where project_id = p_project_id and state <> 'done'
    order by number desc
    limit 1;

  if v_kind = 'story' then
    select state_id, iteration_id
      into v_story
      from public.stories
      where id = v_id and project_id = p_project_id
      for update;
    if not found then
      raise exception 'story not found' using errcode = 'P0002';
    end if;

    if v_story.state_id is distinct from (p_expected->>'state_id')::uuid
       or v_story.iteration_id is distinct from (p_expected->>'iteration_id')::uuid then
      raise exception 'stale story state; refresh and retry' using errcode = 'P0001';
    end if;

    v_state_set := p_deltas ? 'state_id';
    v_new_state_id := case when v_state_set then (p_deltas->>'state_id')::uuid else v_story.state_id end;
    if p_deltas ? 'iteration' then
      if p_deltas->>'iteration' = 'current' then
        if v_current_id is null then
          raise exception 'no active iteration' using errcode = 'P0001';
        end if;
        v_new_iteration := v_current_id;
      else
        v_new_iteration := null;
      end if;
    else
      v_new_iteration := v_story.iteration_id;
    end if;

    update public.stories
      set state_id = v_new_state_id,
          iteration_id = v_new_iteration
      where id = v_id;
  else
    if not exists (
      select 1 from public.backlog_dividers where id = v_id and project_id = p_project_id
    ) then
      raise exception 'divider not found' using errcode = 'P0002';
    end if;
    v_new_state_id := null;
  end if;

  if v_kind = 'divider' then
    v_zone := 'backlog';
  elsif p_view = 'list' and v_new_state_id is not null
        and (v_current_id is null or v_new_iteration is distinct from v_current_id) then
    v_zone := 'backlog';
  else
    v_zone := 'single';
  end if;

  if v_zone = 'single' then
    if p_view = 'tracker' then
      select coalesce(array_agg(id order by position), '{}') into v_story_ids
        from public.stories
        where project_id = p_project_id and id <> v_id
          and iteration_id is not distinct from v_new_iteration
          and state_id is not distinct from v_new_state_id;
    else
      if v_new_state_id is null then
        select coalesce(array_agg(id order by position), '{}') into v_story_ids
          from public.stories
          where project_id = p_project_id and id <> v_id and state_id is null;
      else
        select coalesce(array_agg(id order by position), '{}') into v_story_ids
          from public.stories
          where project_id = p_project_id and id <> v_id and iteration_id = v_current_id;
      end if;
    end if;

    v_pos := 0;
    for i in 1 .. coalesce(array_length(v_story_ids, 1), 0) loop
      if not v_inserted and v_before_id is not null and v_story_ids[i] = v_before_id then
        update public.stories set position = v_pos where id = v_id;
        v_pos := v_pos + 1;
        v_inserted := true;
      end if;
      update public.stories set position = v_pos where id = v_story_ids[i];
      v_pos := v_pos + 1;
    end loop;
    if not v_inserted then
      update public.stories set position = v_pos where id = v_id;
    end if;
    return;
  end if;

  perform public._splice_backlog(p_project_id, v_kind, v_id, v_before_kind, v_before_id);
end;
$$;

alter table public.stories drop column focus;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- alter table public.stories add column focus text check (focus in ('today'));
-- (then restore move_story_board from 20260719000008)
-- drop table public.story_pins;
