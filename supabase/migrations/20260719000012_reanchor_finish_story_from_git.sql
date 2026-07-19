-- ============================================================
-- TASK-91 (doc-8 §2, spec/integrations.md): finish_story_from_git rewritten,
-- not literal-swapped. The old body force-finished into a single fixed
-- state name ('finished'); the new one moves to a per-project configurable
-- target (integrations.config.merge_target_state_id), forward-only, never
-- into a done/rejected-category state.
--
-- "Forward-only" for custom, per-project, arbitrarily-ordered states is
-- expressed as a (category rank, position) comparison against the
-- configured target: unstarted=0, in_progress=1; the Icebox (state_id
-- NULL) ranks before everything. A story already at or past the target
-- (same category and position >=, or already done/rejected) is
-- not_transitionable — matches the old guard's spirit (only
-- unscheduled/unstarted/started, i.e. "not yet at or past Finished",
-- could force-finish) without hardcoding state names.
--
-- merge_target_state_id is an unconstrained jsonb field (no FK — a state
-- id and the state itself live in different tables/writers), so it can go
-- dangling (state renamed/deleted) or point at a done/rejected-category
-- state (config edited after the fact). Both fail closed as 'ignored'
-- rather than erroring or writing anything — the webhook's caller (the
-- git-webhook Edge Function) already treats a non-'finished' outcome as
-- "nothing to do", so this degrades safely to "integration effectively
-- disabled until reconfigured", not a stuck 5xx retry loop.
-- ============================================================

create or replace function public.finish_story_from_git(p_project_id uuid, p_story_number int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
begin
  if not exists (select 1 from public.projects where id = p_project_id) then
    return jsonb_build_array(jsonb_build_object('kind', 'ignored', 'number', p_story_number, 'reason', 'project_not_found'));
  end if;

  select (i.config->>'merge_target_state_id')::uuid into v_target_state_id
    from public.integrations i
    where i.project_id = p_project_id and i.provider in ('github', 'forgejo') and i.is_active
    order by i.created_at
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

  -- Same key finalize_iteration uses: serializes this finish+assign against
  -- rollover/manual finish so the current iteration can't finalize between
  -- the transition and the assignment below.
  perform pg_advisory_xact_lock(v_lock_key);

  select id, iteration_id, state_id into v_story
    from public.stories
    where project_id = p_project_id and number = p_story_number
    for update;

  if not found then
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

  update public.stories set state_id = v_target_state_id where id = v_story.id;

  -- A story force-finished from the Backlog/Icebox (no iteration) would be
  -- stranded there (only an unstarted-category state may cross zones on
  -- the board), so it is pulled into the current iteration — a merged PR
  -- means the work happened in this iteration. Under the shared lock that
  -- iteration cannot finalize mid-flight.
  if v_story.iteration_id is null then
    select id, number into v_current_id, v_current_number
      from public.iterations
      where project_id = p_project_id and state <> 'done'
      order by number desc
      limit 1;

    if v_current_id is not null then
      update public.stories
        set iteration_id = v_current_id
        where id = v_story.id and iteration_id is null;
      return jsonb_build_array(jsonb_build_object(
        'kind', 'finished', 'number', p_story_number, 'iteration_number', v_current_number
      ));
    end if;
  end if;

  return jsonb_build_array(jsonb_build_object('kind', 'finished', 'number', p_story_number));
end;
$$;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- (restore finish_story_from_git from 20260718000001_remove_free_mode.sql —
-- references the dropped stories.state column and cannot run as-is)
