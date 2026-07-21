-- ============================================================
-- TASK-111 (doc-13 finding #2): one iteration-scoped position sequence.
--
-- move_story_board's Kanban branch (p_view = 'tracker') re-densified position
-- scoped to (iteration_id, state_id) — each state column got its own 0-based
-- 0,1,2… run. But the List view renders the current iteration as ONE flat,
-- priority-ordered list (spec/screens.md "List view"), which flattenCurrentZone
-- (apps/web/lib/utils/kanban.ts) produces by sorting every column's stories by
-- a single shared `position`. Column-local positions collide across columns, so
-- after a Kanban within-column reorder the List view interleaved stories from
-- different columns out of order.
--
-- The board loads every story `order by position` and buckets into columns, so
-- Kanban's within-column order is already just a filtered subsequence of the
-- iteration-wide order — meaning one iteration-scoped sequence renders BOTH
-- views correctly and only the tracker WRITE broke it. Fix: the tracker branch
-- now re-densifies the whole current iteration (same set the list branch uses),
-- not one column.
--
-- Column-end drops (Kanban anchor = null) can't just fall through to the shared
-- loop's append-at-end: that would drop the card to the iteration's global
-- bottom in List view. Instead we resolve the drop to a real anchor first — the
-- first story that currently sits after the moved card's column tail in the
-- iteration-wide order — so it lands right after its own column's last story.
-- When the column has no other stories, or its tail is also the iteration tail,
-- the anchor stays null and the shared loop appends at the end (the natural
-- fallback). Everything else (auth, advisory locks, staleness check, backlog
-- splice) is unchanged from 20260720000004_story_pins.sql.
-- ============================================================

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
    -- A Kanban column-end drop gives no anchor (dropped after the column's
    -- last card). Translate it to the iteration-wide anchor so the card lands
    -- right after its own column's tail, not at the whole iteration's bottom.
    -- Null-safe: an empty column (no tail) or a tail that is also the
    -- iteration tail leaves v_before_id null → shared loop appends at end.
    if p_view = 'tracker' and v_before_id is null
       and v_new_state_id is not null and v_new_iteration is not null then
      select id into v_before_id
        from public.stories
        where project_id = p_project_id and id <> v_id
          and iteration_id is not distinct from v_new_iteration
          and position > (
            select max(position) from public.stories
            where id <> v_id and project_id = p_project_id
              and iteration_id is not distinct from v_new_iteration
              and state_id is not distinct from v_new_state_id
          )
        order by position
        limit 1;
    end if;

    -- One iteration-scoped sequence for both views: the current iteration as a
    -- whole (or the Icebox's own null-state set), never a single state column.
    -- Scoping to v_current_id (not v_new_iteration) is safe because any move
    -- reaching this state-non-null branch is within the current iteration:
    -- a client sends iteration:'current' (resolved to v_current_id above) or
    -- keeps a story that was already in a current-iteration state column
    -- (columnForStory/evaluateDrop in the client only offer state columns for
    -- current-iteration stories). A non-current story with a state instead
    -- routes to v_zone='backlog' above.
    if v_new_state_id is null then
      select coalesce(array_agg(id order by position), '{}') into v_story_ids
        from public.stories
        where project_id = p_project_id and id <> v_id and state_id is null;
    else
      select coalesce(array_agg(id order by position), '{}') into v_story_ids
        from public.stories
        where project_id = p_project_id and id <> v_id and iteration_id = v_current_id;
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

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- (restore move_story_board from 20260720000004_story_pins.sql — the tracker
--  branch re-densifying scoped to (iteration_id, state_id), and no column-end
--  anchor pre-resolution)
