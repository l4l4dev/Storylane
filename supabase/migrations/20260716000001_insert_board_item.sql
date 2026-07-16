-- ============================================================
-- TASK-51: transactional backlog insert (insert_board_item).
-- Advisor-approved (Fable, 2026-07-16) — RPC #2 of the TASK-56 position-rules
-- DESIGN, now concretised.
--
-- quickCreateStory's backlog branch and createBacklogDivider each did a
-- non-transactional sequence: read the backlog order (TS), INSERT the row with
-- a placeholder position, splice its id in TS, then rewrite every position via
-- resequence_backlog_order. A failure after the INSERT left an orphaned
-- story/divider with no matching position rewrite, and the quick-add composer's
-- "press Enter to retry" invited a duplicate (doc-1; TASK-51 AC#2).
--
-- insert_board_item folds INSERT + resequence into one transaction: the row can
-- only exist together with its position. It also re-reads the backlog order
-- INSIDE the advisory lock (not from a stale TS snapshot), removing the
-- insert-side TOCTOU the same way move_story_board removed the drag-side one.
--
-- Lock: positions key ONLY. This path never touches iteration_id (a new backlog
-- story is iteration_id null), so — unlike move_story_board — it does NOT take
-- the iteration_finalize lock. Lock-order rule (20260715000009) holds: nothing
-- takes positions before finalize, so a positions-only taker can't deadlock.
--
-- This migration also:
--   * Fixes doc-3 finding #1: move_story_board's List Backlog zone predicate was
--     NULL-unsafe (a backlog story has v_new_iteration NULL, so
--     `v_new_iteration = v_current_id` is NULL → the zone fell through to
--     'single' whenever an active iteration existed, renumbering the CURRENT
--     iteration instead of the two-table backlog). Scheduled for TASK-56 slice 2
--     but never landed; folded here since it shares this exact splice surface.
--   * Extracts the two-table merge+splice into _splice_backlog so
--     move_story_board and insert_board_item share ONE backlog position
--     implementation (TASK-51/56 overlap note: "one position-rules impl").
--   * Drops resequence_backlog_order: its only caller (persistBacklogOrder) is
--     retired by this task. No prod deploy has happened (TASK-3), so there is no
--     old-client coexistence window.
-- ============================================================

-- Internal: merge the two backlog tables (stories with no iteration and not
-- iced, plus all dividers) by their shared position sequence, splice the item
-- (p_kind,p_id) in before the anchor (or append when the anchor is absent or
-- not in the zone), and dense-rewrite via _resequence_backlog. The item is
-- excluded from the merge by id, so its own (placeholder) position never
-- affects ordering. Shared by move_story_board (backlog drops/divider moves)
-- and insert_board_item (new story/divider). The merge predicate must stay
-- identical to fetchBacklogOrder / buildBacklogRows: a story left 'started'
-- with iteration_id null is still a backlog row and must be included, or anchor
-- lookups for it miss and the splice degrades to an append.
create function public._splice_backlog(
  p_project_id uuid,
  p_kind text,
  p_id uuid,
  p_before_kind text,
  p_before_id uuid
)
returns void
language plpgsql
as $$
declare
  v_ordered_kinds text[] := '{}';
  v_ordered_story_ids uuid[] := '{}';
  v_ordered_div_ids uuid[] := '{}';
  v_inserted boolean := false;
  v_rk text;
  v_ri uuid;
begin
  for v_rk, v_ri in
    select kind, id from (
      select 'story'::text as kind, id, position from public.stories
        where project_id = p_project_id and iteration_id is null and state <> 'unscheduled'
      union all
      select 'divider'::text as kind, id, position from public.backlog_dividers
        where project_id = p_project_id
    ) merged
    where not (kind = p_kind and id = p_id)
    order by position
  loop
    if not v_inserted and p_before_id is not null
       and v_rk = p_before_kind and v_ri = p_before_id then
      v_ordered_kinds := v_ordered_kinds || p_kind;
      if p_kind = 'story' then v_ordered_story_ids := v_ordered_story_ids || p_id;
        else v_ordered_div_ids := v_ordered_div_ids || p_id; end if;
      v_inserted := true;
    end if;
    v_ordered_kinds := v_ordered_kinds || v_rk;
    if v_rk = 'story' then v_ordered_story_ids := v_ordered_story_ids || v_ri;
      else v_ordered_div_ids := v_ordered_div_ids || v_ri; end if;
  end loop;
  if not v_inserted then
    v_ordered_kinds := v_ordered_kinds || p_kind;
    if p_kind = 'story' then v_ordered_story_ids := v_ordered_story_ids || p_id;
      else v_ordered_div_ids := v_ordered_div_ids || p_id; end if;
  end if;

  perform public._resequence_backlog(v_ordered_kinds, v_ordered_story_ids, v_ordered_div_ids);
end;
$$;
revoke execute on function public._splice_backlog(uuid, text, uuid, text, uuid) from public, authenticated;

-- Re-create move_story_board: the List Backlog zone predicate is now NULL-safe,
-- and the two-table backlog branch delegates to _splice_backlog. Everything
-- else is unchanged from 20260715000008.
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
  v_new_state text;
  v_new_iteration uuid;
  v_new_status uuid;
  v_new_swimlane uuid;
  v_new_focus text;
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
    select state, iteration_id, custom_status_id, swimlane_id, focus
      into v_story
      from public.stories
      where id = v_id and project_id = p_project_id
      for update;
    if not found then
      raise exception 'story not found' using errcode = 'P0002';
    end if;

    if v_story.state is distinct from (p_expected->>'state')
       or v_story.iteration_id is distinct from (p_expected->>'iteration_id')::uuid
       or v_story.custom_status_id is distinct from (p_expected->>'custom_status_id')::uuid
       or v_story.swimlane_id is distinct from (p_expected->>'swimlane_id')::uuid
       or v_story.focus is distinct from (p_expected->>'focus') then
      raise exception 'stale story state; refresh and retry' using errcode = 'P0001';
    end if;

    v_new_state := coalesce(p_deltas->>'state', v_story.state);
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
    v_new_status := case when p_deltas ? 'custom_status_id'
      then (p_deltas->>'custom_status_id')::uuid else v_story.custom_status_id end;
    v_new_swimlane := case when p_deltas ? 'swimlane_id'
      then (p_deltas->>'swimlane_id')::uuid else v_story.swimlane_id end;
    v_new_focus := case when p_deltas ? 'focus'
      then p_deltas->>'focus' else v_story.focus end;

    update public.stories
      set state = v_new_state,
          iteration_id = v_new_iteration,
          custom_status_id = v_new_status,
          swimlane_id = v_new_swimlane,
          focus = v_new_focus
      where id = v_id;
  else
    if not exists (
      select 1 from public.backlog_dividers where id = v_id and project_id = p_project_id
    ) then
      raise exception 'divider not found' using errcode = 'P0002';
    end if;
    v_new_state := null;
  end if;

  -- Zone selection. A divider is always the backlog. For a story, derive from
  -- its post-delta columns per the view. The List Backlog test is NULL-safe:
  -- a backlog story has v_new_iteration NULL, and `is distinct from` treats
  -- NULL as its own value (so NULL vs a real current-iteration id is "distinct"
  -- → backlog), where the old `= v_current_id` yielded NULL → fell to 'single'.
  if v_kind = 'divider' then
    v_zone := 'backlog';
  elsif p_view = 'list' and v_new_state <> 'unscheduled'
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
          and iteration_id is not distinct from v_new_iteration and state = v_new_state;
    elsif p_view = 'free' then
      select coalesce(array_agg(id order by position), '{}') into v_story_ids
        from public.stories
        where project_id = p_project_id and id <> v_id
          and custom_status_id is not distinct from v_new_status
          and swimlane_id is not distinct from v_new_swimlane;
    elsif p_view = 'focus' then
      select coalesce(array_agg(id order by position), '{}') into v_story_ids
        from public.stories
        where project_id = p_project_id and id <> v_id
          and iteration_id is not distinct from v_new_iteration
          and focus is not distinct from v_new_focus;
    else
      if v_new_state = 'unscheduled' then
        select coalesce(array_agg(id order by position), '{}') into v_story_ids
          from public.stories
          where project_id = p_project_id and id <> v_id and state = 'unscheduled';
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

-- User-facing: creates a backlog story or divider and positions it atomically.
-- Returns the new row's id. p_payload is {title} for a story, {label, kind} for
-- a divider. p_anchor is {before:{kind,id}} to land before that item, else {}
-- (or an anchor not in the backlog) to append.
create function public.insert_board_item(
  p_project_id uuid,
  p_kind text,
  p_payload jsonb,
  p_anchor jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_new_id uuid;
  v_before_kind text := p_anchor->'before'->>'kind';
  v_before_id uuid := (p_anchor->'before'->>'id')::uuid;
  v_title text;
  v_label text;
  v_divider_kind text;
begin
  v_role := public.project_role(p_project_id);
  if v_role is null or v_role not in ('owner', 'member') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('positions:' || p_project_id::text));

  -- Validate + create in the DB (decision-1: invariants live server-side; this
  -- is SECURITY DEFINER and client-callable, so the TS early-returns are a
  -- convenience, not the guarantee). created_by defaults to auth.uid(), which
  -- resolves from the JWT even under SECURITY DEFINER.
  if p_kind = 'story' then
    v_title := btrim(coalesce(p_payload->>'title', ''));
    if v_title = '' then
      raise exception 'title required' using errcode = 'P0001';
    end if;
    insert into public.stories (project_id, title, story_type, state, iteration_id, position)
      values (p_project_id, v_title, 'feature', 'unstarted', null, 0)
      returning id into v_new_id;
  elsif p_kind = 'divider' then
    v_divider_kind := coalesce(p_payload->>'kind', 'note');
    if v_divider_kind not in ('note', 'iteration_break') then
      raise exception 'invalid divider kind' using errcode = 'P0001';
    end if;
    v_label := btrim(coalesce(p_payload->>'label', ''));
    if v_divider_kind = 'note' and v_label = '' then
      raise exception 'label required for note' using errcode = 'P0001';
    end if;
    insert into public.backlog_dividers (project_id, label, kind, position)
      values (p_project_id, v_label, v_divider_kind, 0)
      returning id into v_new_id;
  else
    raise exception 'invalid item kind' using errcode = 'P0001';
  end if;

  perform public._splice_backlog(p_project_id, p_kind, v_new_id, v_before_kind, v_before_id);

  return v_new_id;
end;
$$;

revoke execute on function public.insert_board_item(uuid, text, jsonb, jsonb) from public, authenticated;
grant execute on function public.insert_board_item(uuid, text, jsonb, jsonb) to authenticated;

-- resequence_backlog_order (20260715000009) was the migration-period wrapper for
-- persistBacklogOrder; both are retired by insert_board_item. Drop it so it
-- can't drift as a second, unlocked position path (and remove it from the
-- grant-lockdown allowlist).
drop function public.resequence_backlog_order(uuid, text[], uuid[], uuid[]);

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.insert_board_item(uuid, text, jsonb, jsonb);
-- (restore resequence_backlog_order from 20260715000009 and revert
--  move_story_board to 20260715000008 if fully reverting)
-- drop function public._splice_backlog(uuid, text, uuid, text, uuid);
