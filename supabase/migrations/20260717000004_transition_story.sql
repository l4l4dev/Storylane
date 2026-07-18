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
-- is assigned to is filtered to 0 rows by the FOR UPDATE read below, which
-- raises an explicit permission error instead of a silent no-op (spec/mcp.md
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
  -- Existence check under the stories SELECT policy (any project member), so a
  -- bad id gets a truthful "not found" rather than the permission error below.
  perform 1 from public.stories where id = p_story_id;
  if not found then
    raise exception 'Story not found' using errcode = 'P0002';
  end if;

  -- Authoritative locked read. Because this function is SECURITY INVOKER, RLS
  -- reaches the FOR UPDATE, which applies the stories UPDATE policy (owner, or
  -- member author/assignee). That makes this line do double duty:
  --   1. authorization — a member who may READ but not WRITE this story is
  --      filtered to 0 rows here, so `not found` below is the permission gate;
  --   2. lock — a second accept/reject blocks until the first commits, then
  --      re-reads the committed state so the state machine rejects the now-
  --      invalid action instead of both winning and the last write silently
  --      clobbering the other (lost update corrupts velocity/completed_at —
  --      rls-security-reviewer 2026-07-17).
  -- (The SECURITY DEFINER RPCs elsewhere use FOR UPDATE without effect 1, since
  -- RLS does not apply to them — this RPC is the exception.)
  select project_id, state, story_type, points, iteration_id
    into v_story
    from public.stories
    where id = p_story_id
    for update;
  if not found then
    raise exception 'Not allowed to transition this story (you are not its owner, author, or assignee)'
      using errcode = '42501';
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
    -- This takes the story row lock BEFORE this advisory lock, inverting the
    -- house convention. No deadlock: this branch only runs when iteration_id is
    -- null, and finalize_iteration's bulk update targets iteration_id = <id>
    -- (never null), so the two never contend for the same story row.
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

  -- The FOR UPDATE above already gated authorization, so this normally hits the
  -- locked row. It can still filter to 0 if the caller's membership/role is
  -- revoked in the window between the two statements — project_role() reads the
  -- unlocked project_members table and is re-evaluated per statement. Turn that
  -- into an explicit error, not a misleading success (rls-security-reviewer 2026-07-17).
  if v_rows = 0 then
    raise exception 'Not allowed to transition this story (you are not its owner, author, or assignee)'
      using errcode = '42501';
  end if;

  return jsonb_build_object('story_id', p_story_id, 'state', v_next_state);
end;
$$;

revoke execute on function public.transition_story(uuid, text) from public, authenticated;
grant execute on function public.transition_story(uuid, text) to authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.transition_story(uuid, text);
