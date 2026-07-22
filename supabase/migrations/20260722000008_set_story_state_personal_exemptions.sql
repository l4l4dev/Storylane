-- ============================================================
-- TASK-139 (doc-15 decision 7): exempt personal projects from the two tracker
-- gates in set_story_state, so My Work's Todo/Done drags on personal tasks
-- (never estimated, never in an iteration) don't fail.
--
-- Full replacement of 20260719000007's set_story_state. STAYS SECURITY INVOKER
-- (fable-advisor required correction to doc-15's first draft): the exemption
-- just reads projects.is_personal (member-visible under INVOKER) and skips the
-- estimation gate + the in_progress current-iteration auto-assign. DEFINER
-- would break the caller-gating FOR UPDATE that rides on stories' RLS. A
-- personal story stays iteration-less on any transition (v_current_id stays
-- null, so the UPDATE's iteration_id case leaves it unchanged).
-- ============================================================

create or replace function public.set_story_state(p_story_id uuid, p_state_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_story record;
  v_target_category text;
  v_current_id uuid;
  v_is_personal boolean;
  v_rows int;
begin
  perform 1 from public.stories where id = p_story_id;
  if not found then
    raise exception 'Story not found' using errcode = 'P0002';
  end if;

  -- Authoritative locked read. SECURITY INVOKER means RLS reaches this
  -- FOR UPDATE, applying the stories UPDATE policy — a caller who may READ but
  -- not WRITE this story is filtered to 0 rows here.
  select project_id, state_id, story_type, points, iteration_id
    into v_story
    from public.stories
    where id = p_story_id
    for update;
  if not found then
    raise exception 'Not allowed to change this story''s state' using errcode = '42501';
  end if;

  -- Personal projects are a purely personal surface (doc-15): no estimation,
  -- no iterations. Read the flag (member-visible under INVOKER) to skip both
  -- tracker gates below.
  select is_personal into v_is_personal from public.projects where id = v_story.project_id;

  if p_state_id is not null then
    select category into v_target_category
      from public.project_states
      where id = p_state_id and project_id = v_story.project_id;
    if not found then
      raise exception 'Target state not found in this project' using errcode = 'P0002';
    end if;
  end if;

  -- Estimation gate (spec/features.md) — skipped for personal projects.
  if not coalesce(v_is_personal, false)
     and v_story.story_type = 'feature' and v_story.points is null
     and coalesce(v_target_category, 'unstarted') <> 'unstarted' then
    raise exception 'An unestimated feature can only be in the Icebox or an unstarted state' using errcode = 'P0001';
  end if;

  -- Auto-assign to the current iteration on entering an in_progress-category
  -- state from no iteration — skipped for personal projects (they never have
  -- iterations; the story stays iteration-less).
  if not coalesce(v_is_personal, false)
     and v_target_category = 'in_progress' and v_story.iteration_id is null then
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

  -- Icebox (state_id NULL) never carries an iteration_id.
  update public.stories
    set state_id = p_state_id,
        iteration_id = case
          when p_state_id is null then null
          when v_current_id is not null then v_current_id
          else iteration_id
        end
    where id = p_story_id;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    raise exception 'Not allowed to change this story''s state' using errcode = '42501';
  end if;

  return jsonb_build_object('story_id', p_story_id, 'state_id', p_state_id);
end;
$$;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- (restore set_story_state from 20260719000007_set_story_state.sql)
