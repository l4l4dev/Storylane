-- ============================================================
-- TASK-211: finish_story_from_git reads its webhook configuration after every
-- wait, not before them.
--
-- The integration row and merge_target_state_id are preconditions enforced
-- nowhere but inside this function, so they have to be read after the last
-- point the call can block — the iteration_finalize advisory lock AND the
-- story's own `for update`. Reading them earlier lets an owner disable the
-- integration or repoint its merge target during either wait and still have the
-- story transitioned against the configuration that was live when the delivery
-- arrived (spec/rls.md "Re-check the role AFTER an advisory lock" covers every
-- such precondition, not only the role).
--
-- The read is placed after both waits rather than duplicated on either side of
-- them: nothing before the row lock needs the values, so an earlier copy would
-- only be dead weight.
--
-- Executable by service_role only.
-- ============================================================

create or replace function public.finish_story_from_git(p_project_id uuid, p_story_number integer, p_provider text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lock_key bigint := hashtext('iteration_finalize:' || p_project_id::text);
  v_target_state_id uuid;
  v_target_category text;
  v_target_position int;
  v_target_rank int;
  v_story record;
  v_story_category text;
  v_story_position int;
  v_story_rank int;
  v_current_id uuid;
  v_current_number int;
  v_needs_iteration boolean;
  v_story_exists boolean;
begin
  if not exists (select 1 from public.projects where id = p_project_id) then
    return jsonb_build_array(jsonb_build_object('kind', 'ignored', 'number', p_story_number, 'reason', 'project_not_found'));
  end if;

  -- Same key finalize_iteration uses: serializes this finish+assign against
  -- rollover/manual finish so the current iteration can't finalize between
  -- the transition and the assignment below.
  perform pg_advisory_xact_lock(v_lock_key);


  select id, iteration_id, state_id, story_type, points into v_story
    from public.stories
    where project_id = p_project_id and number = p_story_number
    for update;
  -- Captured immediately: the config reads below run their own statements, and
  -- FOUND reflects only the most recent one.
  v_story_exists := found;

  -- Read after BOTH waits — the advisory lock and the row lock above. Either
  -- can block for an unbounded time, so an integration disabled or repointed
  -- during one of them would otherwise transition the story using whatever
  -- configuration was live when the webhook arrived. spec/rls.md's rule covers
  -- every precondition enforced only inside the RPC, and the last wait is the
  -- only safe place to read one.
  select (i.config->>'merge_target_state_id')::uuid into v_target_state_id
    from public.integrations i
    where i.project_id = p_project_id and i.provider = p_provider and i.is_active
    limit 1;

  if v_target_state_id is null then
    return jsonb_build_array(jsonb_build_object('kind', 'ignored', 'number', p_story_number, 'reason', 'not_configured'));
  end if;

  select category, position into v_target_category, v_target_position
    from public.project_states
    where id = v_target_state_id and project_id = p_project_id;

  -- Dangling (renamed/deleted since configured) or misconfigured
  -- (done/rejected) target — fail closed rather than write anything.
  if v_target_category is null or v_target_category in ('done', 'rejected') then
    return jsonb_build_array(jsonb_build_object('kind', 'ignored', 'number', p_story_number, 'reason', 'target_state_invalid'));
  end if;
  v_target_rank := case v_target_category when 'unstarted' then 0 else 1 end; -- 'in_progress'

  if not v_story_exists then
    return jsonb_build_array(jsonb_build_object('kind', 'not_transitionable', 'number', p_story_number));
  end if;



  if v_story.state_id is not null then
    select category, position into v_story_category, v_story_position
      from public.project_states where id = v_story.state_id;
    v_story_rank := case v_story_category
      when 'unstarted' then 0
      when 'in_progress' then 1
      else 2 -- done / rejected: already past anything the target could be
    end;
  else
    v_story_rank := -1; -- Icebox: before everything
    v_story_position := -1;
  end if;

  if v_story_rank > v_target_rank
     or (v_story_rank = v_target_rank and v_story_position >= v_target_position) then
    return jsonb_build_array(jsonb_build_object('kind', 'not_transitionable', 'number', p_story_number));
  end if;

  -- An unestimated feature cannot enter a non-unstarted state
  -- (stories_enforce_board_invariants). Report it the same way as every other
  -- precondition this function declines on: git-webhook turns a raised
  -- exception into a 500, and the provider would then redeliver a merge that
  -- can never succeed — taking every later story number in the same push down
  -- with it. Scoped to a non-unstarted target, since a project may legitimately
  -- point merge_target_state_id at an unstarted state, which stays open to
  -- unestimated work.
  if v_target_category <> 'unstarted'
     and v_story.story_type = 'feature' and v_story.points is null then
    return jsonb_build_array(jsonb_build_object(
      'kind', 'ignored', 'number', p_story_number, 'reason', 'unestimated'
    ));
  end if;

  -- A story force-finished from the Backlog/Icebox (no iteration) would be
  -- stranded there (only an unstarted-category state may cross zones on
  -- the board, and the Kanban board renders no Backlog/Icebox columns at
  -- all), so it must be pulled into the current iteration — a merged PR
  -- means the work happened in this iteration. Resolved BEFORE writing
  -- state_id: iterations are lazy-created on Board visit, so a project
  -- nobody has opened yet may have none, and writing state_id first would
  -- leave such a story with its target state but no iteration — invisible
  -- on the board. Fail closed instead: if an iteration is needed and none
  -- exists, change nothing.
  v_needs_iteration := v_story.iteration_id is null;
  if v_needs_iteration then
    select id, number into v_current_id, v_current_number
      from public.iterations
      where project_id = p_project_id and state <> 'done'
      order by number desc
      limit 1;

    if v_current_id is null then
      return jsonb_build_array(jsonb_build_object(
        'kind', 'ignored', 'number', p_story_number, 'reason', 'no_active_iteration'
      ));
    end if;
  end if;

  -- One statement, not state_id then iteration_id: the two-write version left
  -- the row transiently at its target state with no iteration, which is exactly
  -- the shape the comment above says must never exist and which
  -- stories_enforce_board_invariants (TASK-208) now rejects.
  update public.stories
    set state_id = v_target_state_id,
        iteration_id = case when v_needs_iteration then v_current_id else iteration_id end
    where id = v_story.id;

  if v_needs_iteration then
    return jsonb_build_array(jsonb_build_object(
      'kind', 'finished', 'number', p_story_number, 'iteration_number', v_current_number
    ));
  end if;

  return jsonb_build_array(jsonb_build_object('kind', 'finished', 'number', p_story_number));
end;
$function$;

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
-- (restore finish_story_from_git from
--  20260728040300_finish_story_from_git_single_write.sql)
-- ============================================================
