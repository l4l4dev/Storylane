-- ============================================================
-- TASK-53: transactional "finish story from a merged PR" for the git-webhook
-- Edge Function. Advisor-approved design (Fable, 2026-07-12; task notes).
--
-- Replaces the Edge Function's two separate writes (state -> 'finished', then
-- a later read + iteration_id assignment) that Codex flagged (doc-1): the
-- handler ignored the iteration read/assignment errors and returned 200 while
-- the story was finished but stranded outside an iteration, and a rollover
-- could finalize the current iteration *between* the two writes. Both the
-- conditional finish and the current-iteration assignment now happen in one
-- transaction under the same advisory lock finalize_iteration uses, so a
-- webhook finish can never interleave with a rollover/manual finish.
--
-- GRANT: service-role only. The Edge Function runs server-side under the
-- service role; no authenticated user may call this to force-finish stories.
-- ============================================================

create function public.finish_story_from_git(p_project_id uuid, p_story_number int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_key bigint := hashtext('iteration_finalize:' || p_project_id::text);
  v_mode text;
  v_story record;
  v_current_id uuid;
  v_current_number int;
begin
  -- Single enforcement point for the tracker-only rule (previously duplicated
  -- in the Edge Function, TASK-28): free mode ignores story state, so a merged
  -- PR finishes nothing there.
  select workflow_mode into v_mode from public.projects where id = p_project_id;
  if v_mode is null then
    return jsonb_build_array(jsonb_build_object('kind', 'ignored', 'number', p_story_number, 'reason', 'project_not_found'));
  end if;
  if v_mode <> 'tracker' then
    return jsonb_build_array(jsonb_build_object('kind', 'ignored', 'number', p_story_number, 'reason', 'not_tracker'));
  end if;

  -- Same key as finalize_iteration (20260709000002): serializes this
  -- finish+assign against rollover/manual finish for the project, so the
  -- current iteration cannot finalize between the transition and the
  -- assignment below. Held to end of transaction.
  perform pg_advisory_xact_lock(v_lock_key);

  -- Force-finish (spec/integrations.md): a merged PR jumps the story to
  -- 'finished' from any pre-finished state, bypassing the one-step machine;
  -- anything already finished/beyond is left alone. The WHERE predicate is
  -- the guard — 0 rows updated is an explicit 'not_transitionable' result
  -- (already finished, or no such story), never a silent success.
  update public.stories
    set state = 'finished'
    where project_id = p_project_id
      and number = p_story_number
      and state in ('unscheduled', 'unstarted', 'started')
    returning id, iteration_id into v_story;

  if not found then
    return jsonb_build_array(jsonb_build_object('kind', 'not_transitionable', 'number', p_story_number));
  end if;

  -- A story finished from the Backlog/Icebox (no iteration) would be stranded
  -- there (only 'unstarted' stories may cross zones on the board), so it is
  -- pulled into the current iteration — a merged PR means the work happened
  -- in this iteration. Under the shared lock that iteration cannot finalize
  -- mid-flight, so the assignment can't land on a just-done iteration (which
  -- the reject_done_iteration trigger would reject anyway).
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

-- Lock down to the service role only. CREATE grants EXECUTE to PUBLIC by
-- default, and the schema's default privileges (20260630000002_grants.sql)
-- also grant it to `authenticated`; revoke both. service_role keeps EXECUTE
-- via its own default-privileges grant (20260707000006_grants_service_role.sql)
-- — the git-webhook Edge Function calls this under SUPABASE_SERVICE_ROLE_KEY.
revoke execute on function public.finish_story_from_git(uuid, int) from public, authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.finish_story_from_git(uuid, int);
