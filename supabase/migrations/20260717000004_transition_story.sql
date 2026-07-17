-- ============================================================
-- TASK-48: transition_story RPC — the authoritative story lifecycle
-- transition, shared by the MCP server and (in TASK-50) the Web action.
-- Advisor-approved design (Fable, 2026-07-11, TASK-47 verdict).
--
-- The one-step state machine, the unestimated-feature guard, and the
-- start-from-backlog current-iteration assignment (TASK-19) currently live
-- ONLY in the Web `transitionStory` server action. A third client (the MCP
-- bot) doing a direct UPDATE would bypass all three. This RPC owns them so
-- every client transitions identically.
--
-- SECURITY INVOKER: the UPDATE runs as the caller, so the existing stories
-- UPDATE policy (owner, or member who authored/is assigned to the story)
-- gates who may transition — exactly what the Web action's plain UPDATE
-- relied on. A member-role bot transitioning a story it neither authored nor
-- is assigned to is filtered to 0 rows by RLS; the row-count check below turns
-- that into an explicit error instead of a silent no-op (spec/mcp.md
-- write-path rules). The RPC does NOT notify Slack or finalize the iteration —
-- side effects and lazy rollover stay with the caller (spec/mcp.md).
--
-- The done-iteration guard trigger (reject_done_iteration_assignment,
-- 20260709000002) is untouched: it still rejects assigning a story into a
-- done iteration, and the advisory lock below keeps the current iteration from
-- finalizing between the lookup and the assignment.
-- ============================================================

create function public.transition_story(p_story_id uuid, p_action text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_story record;
  v_next_state text;
  v_assign_iteration boolean := false;
  v_current_id uuid;
  v_rows int;
begin
  -- Read is gated by the stories SELECT policy (any project member); the
  -- write below is gated more narrowly.
  select project_id, state, story_type, points, iteration_id
    into v_story
    from public.stories
    where id = p_story_id;
  if not found then
    raise exception 'Story not found' using errcode = 'P0002';
  end if;

  -- One-step lifecycle machine (mirrors @storylane/core story-state.ts, which
  -- the client still uses to render the buttons). Any action not valid from
  -- the current state raises — never a silent wrong jump.
  v_next_state := case
    when p_action = 'start'   and v_story.state = 'unstarted' then 'started'
    when p_action = 'finish'  and v_story.state = 'started'   then 'finished'
    when p_action = 'deliver' and v_story.state = 'finished'  then 'delivered'
    when p_action = 'accept'  and v_story.state = 'delivered' then 'accepted'
    when p_action = 'reject'  and v_story.state = 'delivered' then 'rejected'
    when p_action = 'restart' and v_story.state = 'rejected'  then 'started'
    else null
  end;
  if v_next_state is null then
    raise exception 'Cannot "%" a story in state "%"', p_action, v_story.state
      using errcode = 'P0001';
  end if;

  -- An unestimated feature cannot be started (spec/features.md) — covers both
  -- Start and Restart, whose target is 'started'.
  if v_next_state = 'started'
     and v_story.story_type = 'feature'
     and v_story.points is null then
    raise exception 'An unestimated feature cannot be started' using errcode = 'P0001';
  end if;

  -- Starting/restarting a story with no iteration pulls it into the current
  -- one (TASK-19) — otherwise it ends up 'started' with iteration_id null:
  -- invisible to velocity, never carried by rollover, undraggable back.
  v_assign_iteration := v_next_state = 'started' and v_story.iteration_id is null;

  if v_assign_iteration then
    -- Serialize against rollover/manual finish (same key finalize_iteration
    -- uses) so the current iteration can't finalize between this lookup and
    -- the UPDATE — the done-iteration trigger would reject a done target.
    perform pg_advisory_xact_lock(hashtext('iteration_finalize:' || v_story.project_id::text));

    select id into v_current_id
      from public.iterations
      where project_id = v_story.project_id and state <> 'done'
      order by number desc
      limit 1;
    if v_current_id is null then
      raise exception 'No active iteration' using errcode = 'P0001';
    end if;
  end if;

  update public.stories
    set state = v_next_state,
        iteration_id = case when v_assign_iteration then v_current_id else iteration_id end
    where id = p_story_id;
  get diagnostics v_rows = row_count;

  -- RLS filtered the write to nothing: the caller is not the owner, author, or
  -- assignee of this story. Explicit error, not a silent success (spec/mcp.md).
  if v_rows = 0 then
    raise exception 'Not allowed to transition this story (you are not its owner, author, or assignee)'
      using errcode = '42501';
  end if;

  return jsonb_build_object('story_id', p_story_id, 'state', v_next_state);
end;
$$;

revoke execute on function public.transition_story(uuid, text) from public;
grant execute on function public.transition_story(uuid, text) to authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.transition_story(uuid, text);
