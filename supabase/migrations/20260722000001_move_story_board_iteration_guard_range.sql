-- ============================================================
-- TASK-134 + TASK-136: move_story_board correctness + efficiency.
--
-- TASK-134 (cross-iteration corruption, doc-13-followup review):
-- the reroute guard only fired for p_view = 'list'. A p_view = 'tracker' (or
-- any forged/unknown p_view — the RPC is granted to `authenticated` and does
-- not enum-check it) state-bearing move whose story iteration isn't the
-- current one fell into the 'single' zone, whose rewrite scoped by the CURRENT
-- iteration while the story kept its own (different) iteration_id — giving it a
-- position from the wrong iteration's sequence. Reachable via a done-category
-- story: finalize_iteration does NOT carry its iteration_id forward, and the
-- stories_reject_done_iteration_update trigger only fires when iteration_id
-- actually changes (20260709000002), so a stale tracker drag (no iteration
-- delta) writes iteration_id back unchanged, slips past both, and corrupts.
-- Fix: a state-bearing move whose destination isn't the current iteration is
-- routed to the backlog splice for p_view = 'list' (a legitimate current→
-- backlog drag) but REJECTED for any other view — a tracker column is always
-- the current iteration, so this is only a stale board or a forged call. The
-- single-zone rewrite + the column-end anchor query now share one iteration
-- scope (v_new_iteration), so they can't diverge.
--
-- TASK-136 (efficiency): TASK-111 correctly made position ONE dense iteration-
-- wide sequence, but re-densified the WHOLE iteration via N per-row UPDATEs on
-- every reorder, holding the project-wide advisory lock proportional to board
-- size. A dense-sequence move only needs to touch the rows BETWEEN the moved
-- story's old and target position (rows outside that range never change,
-- whatever column they're in). Replaced the per-row loop with two set-based
-- range UPDATEs. Why-not: a move that ENTERS the sequence (backlog/Icebox →
-- current) has no old slot, so it shifts target..end (O(N) worst case) — that's
-- inherent to dense-integer positions and out of scope here.
--
-- Everything else (auth, advisory locks, staleness check, backlog splice) is
-- unchanged from 20260721000007.
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
  v_was_in_scope boolean;
  v_old_pos int;
  v_before_pos int;
  v_target int;
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
    select state_id, iteration_id, position
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
  elsif v_new_state_id is not null
        and (v_current_id is null or v_new_iteration is distinct from v_current_id) then
    -- A state-bearing story whose destination isn't the current iteration.
    -- List view: a legitimate current→backlog drag (v_new_iteration = null),
    -- spliced into the backlog sequence below. Any other view (tracker — whose
    -- columns are always the current iteration — or a forged p_view): reject,
    -- so the single-zone rewrite can't renumber it into the wrong iteration's
    -- sequence (TASK-134). The story row's own state/iteration were already set
    -- above; the raise rolls the whole transaction back.
    if p_view <> 'list' then
      raise exception 'stale story state; refresh and retry' using errcode = 'P0001';
    end if;
    v_zone := 'backlog';
  else
    v_zone := 'single';
  end if;

  if v_zone = 'single' then
    -- A Kanban column-end drop gives no anchor (dropped after the column's
    -- last card). Translate it to the iteration-wide anchor so the card lands
    -- right after its own column's tail, not at the whole iteration's bottom.
    -- Null-safe: an empty column (no tail) or a tail that is also the
    -- iteration tail leaves v_before_id null → append at the sequence's end.
    if p_view = 'tracker' and v_before_id is null
       and v_new_state_id is not null and v_new_iteration is not null then
      with iter_stories as (
        select id, position, state_id from public.stories
        where project_id = p_project_id and id <> v_id
          and iteration_id is not distinct from v_new_iteration
      )
      select id into v_before_id
        from iter_stories
        where position > (
          select max(position) from iter_stories
          where state_id is not distinct from v_new_state_id
        )
        order by position
        limit 1;
    end if;

    -- One iteration-scoped sequence for both views: the current iteration as a
    -- whole (or the Icebox's own null-state set), never a single state column.
    -- The scope predicate (reused verbatim below) is the moved story's NEW
    -- home: the current iteration for a board move, all state-null stories for
    -- an Icebox move.
    v_old_pos := v_story.position;
    if v_before_id = v_id then
      v_before_id := null; -- defensive: never anchor a story before itself
    end if;

    -- Was the story already part of this sequence (its PRE-update state/
    -- iteration)? If so its old position is a real slot to move FROM (bounded
    -- range shift); if not, it's entering and we insert (shift target..end).
    v_was_in_scope := case
      when v_new_state_id is null then v_story.state_id is null
      else v_story.iteration_id is not distinct from v_new_iteration
    end;

    if v_before_id is not null then
      select position into v_before_pos
        from public.stories
        where id = v_before_id and project_id = p_project_id
          and case when v_new_state_id is null then state_id is null
                   else iteration_id is not distinct from v_new_iteration end;
    end if;

    if v_before_pos is null then
      -- Append (no anchor, or an anchor not in this sequence). Land past the
      -- current last story: max(position)+1, NOT count(*) — positions can be
      -- sparse (a List current→backlog drag or finalize_iteration vacates a
      -- slot and nothing re-densifies), so a count would land the card
      -- mid-sequence. No shift: the card jumps past the max and its own old
      -- slot, if any, is left as a gap — consistent with this function's
      -- minimal-touch, gap-tolerant model.
      select coalesce(max(position), -1) + 1 into v_target
        from public.stories
        where project_id = p_project_id and id <> v_id
          and case when v_new_state_id is null then state_id is null
                   else iteration_id is not distinct from v_new_iteration end;
      update public.stories set position = v_target where id = v_id;
      return;
    end if;

    -- Anchored move: land immediately before v_before_id via a bounded range
    -- shift — only rows between the vacated old slot and the target move,
    -- everything outside keeps its position.
    if v_was_in_scope and v_old_pos < v_before_pos then
      v_target := v_before_pos - 1; -- moving down
      update public.stories set position = position - 1
        where project_id = p_project_id and id <> v_id
          and case when v_new_state_id is null then state_id is null
                   else iteration_id is not distinct from v_new_iteration end
          and position > v_old_pos and position <= v_target;
    elsif v_was_in_scope then
      v_target := v_before_pos; -- moving up
      update public.stories set position = position + 1
        where project_id = p_project_id and id <> v_id
          and case when v_new_state_id is null then state_id is null
                   else iteration_id is not distinct from v_new_iteration end
          and position >= v_target and position < v_old_pos;
    else
      -- Entering the sequence with an anchor: open a slot at the target
      -- (shifts target..end — O(N) worst case, inherent to dense-int positions).
      v_target := v_before_pos;
      update public.stories set position = position + 1
        where project_id = p_project_id and id <> v_id
          and case when v_new_state_id is null then state_id is null
                   else iteration_id is not distinct from v_new_iteration end
          and position >= v_target;
    end if;

    update public.stories set position = v_target where id = v_id;
    return;
  end if;

  perform public._splice_backlog(p_project_id, v_kind, v_id, v_before_kind, v_before_id);
end;
$$;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- (restore move_story_board from 20260721000007_move_story_board_global_positions.sql —
--  the p_view='list'-only reroute guard, the v_current_id-scoped whole-iteration
--  re-densify loop, and the non-CTE anchor query)
