-- ============================================================
-- TASK-56: transactional board move + reorder (move_story_board).
-- Advisor-revised design (Opus, 2026-07-15; task-56 plan) on top of the
-- Fable DESIGN in the task notes.
--
-- Replaces the non-atomic pattern in board/actions.ts (dropStory /
-- dropStoryFree / setStoryFocus / dropStoryInList): each read the story,
-- changed state/status/focus, then fired many independent position UPDATEs
-- through Promise.all. Codex (doc-1, Concurrency High): a mid-flight failure
-- left the state change plus a partial reorder (duplicate/gapped positions),
-- and two concurrent drags overwrote each other from stale client sequences.
--
-- The fix is INTENT-based, not full-sequence: the client sends only an anchor
-- (place the item before neighbour N, or at the zone's end); the server
-- re-derives dense positions from the CURRENT DB order inside one advisory-
-- locked transaction. That removes the stale-client-sequence overwrite class
-- entirely rather than only its symptoms.
--
-- Two subtleties the advisor called out:
--   * No client-supplied zone predicate. The resequence zone is derived from
--     the moved story's OWN columns AFTER the deltas are applied, so a stale
--     read on the caller's side can't misdirect the reorder.
--   * iteration='current' is re-resolved HERE under the lock (not passed as an
--     id), and this function takes the SAME iteration_finalize lock that
--     finalize_iteration/finish_story_from_git use — so a move can never
--     attach a story to an iteration that a concurrent rollover is finalizing.
--
-- The transition VALIDATION (evaluateDrop/evaluateListDrop/evaluateFocusDrop)
-- stays server-side in the calling action, which computes p_deltas + p_expected
-- from a trusted read; this function trusts those deltas but guards every
-- zone-determining column via p_expected under the lock (stale → raise, the
-- client refreshes). state/custom_status_id changes fire the existing
-- completed_at + activity_logs triggers, so nothing is logged bespoke here.
-- ============================================================

-- Internal: dense-rewrite the shared backlog position sequence across BOTH
-- stories and backlog_dividers, given the final interleaved order as parallel
-- kind/id arrays. The backlog list interleaves the two tables in one position
-- space (spec/data-model.md; lib/utils/iterations.ts buildBacklogRows), so
-- they must be renumbered together. Extracted for reuse by TASK-51's
-- insert_board_item, which builds a different order but shares this write.
create function public._resequence_backlog(p_kinds text[], p_story_ids uuid[], p_divider_ids uuid[])
returns void
language plpgsql
as $$
declare
  v_pos int := 0;
  v_si int := 1;  -- next index into p_story_ids
  v_di int := 1;  -- next index into p_divider_ids
  v_kind text;
begin
  foreach v_kind in array p_kinds loop
    if v_kind = 'story' then
      update public.stories set position = v_pos where id = p_story_ids[v_si];
      v_si := v_si + 1;
    else
      update public.backlog_dividers set position = v_pos where id = p_divider_ids[v_di];
      v_di := v_di + 1;
    end if;
    v_pos := v_pos + 1;
  end loop;
end;
$$;
revoke execute on function public._resequence_backlog(text[], uuid[], uuid[]) from public, authenticated;

create function public.move_story_board(
  p_project_id uuid,
  p_item jsonb,      -- {kind:'story'|'divider', id:uuid}
  p_view text,       -- 'tracker' | 'free' | 'focus' | 'list'
  p_expected jsonb,  -- snapshot {state, iteration_id, custom_status_id, swimlane_id, focus}; ignored for a divider
  p_deltas jsonb,    -- {state?, iteration?('current'|'none'), custom_status_id?, swimlane_id?, focus?}; empty for a divider
  p_anchor jsonb     -- {before:{kind,id}} to place before that item, else {} / to_end -> append
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
  v_zone text;                 -- 'single' or 'backlog'
  v_before_kind text := p_anchor->'before'->>'kind';
  v_before_id uuid := (p_anchor->'before'->>'id')::uuid;
  -- resequence working state
  v_story_ids uuid[];          -- single-table order, or the story slots of a backlog order
  v_kinds text[];
  v_div_ids uuid[];
  v_ordered_kinds text[] := '{}';
  v_ordered_story_ids uuid[] := '{}';
  v_ordered_div_ids uuid[] := '{}';
  v_inserted boolean := false;
  v_rk text;
  v_ri uuid;
  v_pos int;
  i int;
begin
  v_role := public.project_role(p_project_id);
  if v_role is null or v_role not in ('owner', 'member') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Serialize with iteration finalization first, then with position writes.
  -- Fixed order (finalize-key before positions-key) across the codebase —
  -- finalize_iteration/finish_story_from_git take only the finalize key, and
  -- nothing takes positions before finalize — so no cycle is possible.
  perform pg_advisory_xact_lock(hashtext('iteration_finalize:' || p_project_id::text));
  perform pg_advisory_xact_lock(hashtext('positions:' || p_project_id::text));

  -- The latest non-done iteration, resolved under the lock (not trusted from
  -- the caller): used both to satisfy iteration='current' and to recognise the
  -- List "current" zone.
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

    -- Stale-read guard: every zone-determining column must still match the
    -- snapshot the caller validated against. Any mismatch means the board
    -- moved under the drag — reject so the client refreshes.
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
        v_new_iteration := null;  -- 'none'
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
    -- A backlog divider move: never touches story columns, only reorders.
    -- Ownership guard (mirrors the story branch): without it, a caller who is
    -- an owner of p_project_id could pass a divider id from ANOTHER project and
    -- the resequence's fallback-append would silently overwrite that foreign
    -- row's position — this is SECURITY DEFINER, so RLS won't stop it.
    if not exists (
      select 1 from public.backlog_dividers where id = v_id and project_id = p_project_id
    ) then
      raise exception 'divider not found' using errcode = 'P0002';
    end if;
    v_new_state := null;
  end if;

  -- Decide whether this move resequences a single-table zone or the two-table
  -- backlog. A divider is always the backlog. For a story, derive from its
  -- post-delta columns per the view (never a caller-passed predicate).
  if v_kind = 'divider' then
    v_zone := 'backlog';
  elsif p_view = 'list' and v_new_state <> 'unscheduled'
        and not (v_current_id is not null and v_new_iteration = v_current_id) then
    -- List Backlog zone: no iteration (or a stray non-current one) and not iced.
    v_zone := 'backlog';
  else
    v_zone := 'single';
  end if;

  if v_zone = 'single' then
    -- Gather the zone's current order (excluding the moved story) by view.
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
    else  -- list current / list icebox
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

    -- Splice the moved story before the anchor (or append), then dense-write.
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

  -- Backlog (two-table). Merge stories + dividers by position, excluding the
  -- moved item, then splice it before the anchor and renumber both tables.
  for v_rk, v_ri in
    select kind, id from (
      select 'story'::text as kind, id, position from public.stories
        where project_id = p_project_id and iteration_id is null and state <> 'unscheduled'
      union all
      select 'divider'::text as kind, id, position from public.backlog_dividers
        where project_id = p_project_id
    ) merged
    where not (kind = v_kind and id = v_id)
    order by position
  loop
    if not v_inserted and v_before_id is not null
       and v_rk = v_before_kind and v_ri = v_before_id then
      v_ordered_kinds := v_ordered_kinds || v_kind;
      if v_kind = 'story' then v_ordered_story_ids := v_ordered_story_ids || v_id;
        else v_ordered_div_ids := v_ordered_div_ids || v_id; end if;
      v_inserted := true;
    end if;
    v_ordered_kinds := v_ordered_kinds || v_rk;
    if v_rk = 'story' then v_ordered_story_ids := v_ordered_story_ids || v_ri;
      else v_ordered_div_ids := v_ordered_div_ids || v_ri; end if;
  end loop;
  if not v_inserted then
    v_ordered_kinds := v_ordered_kinds || v_kind;
    if v_kind = 'story' then v_ordered_story_ids := v_ordered_story_ids || v_id;
      else v_ordered_div_ids := v_ordered_div_ids || v_id; end if;
  end if;

  perform public._resequence_backlog(v_ordered_kinds, v_ordered_story_ids, v_ordered_div_ids);
end;
$$;

-- User-facing RPC: the four board drop actions call it as authenticated. Per
-- the TASK-55 grant lockdown, CREATE grants EXECUTE to PUBLIC + the schema
-- default grants it to authenticated; revoke both and re-grant explicitly.
revoke execute on function public.move_story_board(uuid, jsonb, text, jsonb, jsonb, jsonb) from public, authenticated;
grant execute on function public.move_story_board(uuid, jsonb, text, jsonb, jsonb, jsonb) to authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.move_story_board(uuid, jsonb, text, jsonb, jsonb, jsonb);
-- drop function public._resequence_backlog(text[], uuid[], uuid[]);
