-- ============================================================
-- TASK-58 slice 2a follow-up: keep promote_story_to_epic inside the position
-- invariant. Advisor-approved (Fable, 2026-07-16).
--
-- Supersedes the definition in 20260715000006_activity_logs_integrity.sql.
--
-- Fixes two defects, one new and one long-standing:
--
-- 1. REGRESSION from 20260716000004. Positions are now issued by
--    stories_position_seq, which only appends while it stays ahead of every
--    position in use. Promotion is the only writer that moves positions UP (to
--    open a gap for the task-stories), so it could push rows past the sequence
--    and make the next created story land mid-list, sharing a position with a
--    task-story. Reproduced: A(5 tasks)/B/C created from the sequence, promote
--    A, create one story -> it landed 4th, colliding with 'task 4'.
--
-- 2. PRE-EXISTING (predates the sequence). The shift skipped
--    backlog_dividers, so in the backlog zone with k>=2 tasks a story right
--    before a divider jumped over it — the two tables share one position
--    sequence (20260707000001) and only one of them was being shifted.
--
-- The fix is not a zone-aware rewrite: a MONOTONE remap preserves the order of
-- every subset, so ranking the project's rows by (position, id) and writing
-- 0..n-1 back keeps every zone's relative order intact without the RPC ever
-- naming a zone predicate. After compaction all values sit below the sequence,
-- restoring "only the sequence issues new values; rewrites only move them
-- down". It also self-heals rows already inflated or collided by defect 1.
--
-- LOCK ORDER: positions BEFORE story_number. assign_story_number()
-- (20260707000004:44) fires on every stories INSERT and takes story_number, so
-- insert_board_item — which takes positions first — effectively holds
-- positions -> story_number. Any new position writer must take them in that
-- order or it deadlocks AB-BA against it.
-- ============================================================

create or replace function public.promote_story_to_epic(p_story_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_story       public.stories%rowtype;
  v_task_count  int;
  v_task_ids    uuid[];
  v_task_titles text[];
  v_epic_id     uuid;
  v_new_ids     uuid[] := '{}';
  v_new_id      uuid;
  v_idx         int;
  v_state       text;
  v_iteration   uuid;
  v_iter_state  text;
begin
  -- Owner gate first (see below), then lock. Under SECURITY DEFINER RLS is
  -- bypassed, so unlike the previous invoker version the locked re-read can't
  -- be filtered by the stories UPDATE policy — but the owner check remains the
  -- authoritative gate, and the double read still closes the delete race.
  select * into v_story from public.stories where id = p_story_id;
  if not found then
    raise exception 'Story not found';
  end if;

  if coalesce(public.project_role(v_story.project_id), '') <> 'owner' then
    raise exception 'Only project owners can promote a story to an epic';
  end if;

  perform pg_advisory_xact_lock(hashtext('positions:' || v_story.project_id::text));
  perform pg_advisory_xact_lock(hashtext('story_number:' || v_story.project_id::text));

  select * into v_story from public.stories where id = p_story_id for update;
  if not found then
    raise exception 'Story not found';
  end if;

  with locked_tasks as (
    select id, title, position from public.tasks where story_id = p_story_id for update
  )
  select array_agg(id order by position), array_agg(title order by position)
  into v_task_ids, v_task_titles
  from locked_tasks;
  v_task_count := coalesce(array_length(v_task_ids, 1), 0);

  insert into public.epics (project_id, name, description)
  values (v_story.project_id, v_story.title, v_story.description)
  returning id into v_epic_id;

  if v_task_count > 0 then
    v_state := case when v_story.state = 'unscheduled' then 'unscheduled' else 'unstarted' end;

    select state into v_iter_state from public.iterations where id = v_story.iteration_id;
    v_iteration := case when v_iter_state = 'done' then null else v_story.iteration_id end;

    update public.stories
    set position = position + (v_task_count - 1)
    where project_id = v_story.project_id and position > v_story.position;

    -- Dividers share the backlog's position sequence, so they shift with it.
    update public.backlog_dividers
    set position = position + (v_task_count - 1)
    where project_id = v_story.project_id and position > v_story.position;

    for v_idx in 1..v_task_count loop
      -- position omitted on purpose: every INSERT must consume the sequence
      -- (20260716000005), or the frontier falls behind the row count. The
      -- task-stories are moved down to their real slots right after the loop.
      insert into public.stories (
        project_id, iteration_id, epic_id, title, story_type, state, points,
        assignee_id, created_by, custom_status_id, swimlane_id
      ) values (
        v_story.project_id, v_iteration, v_epic_id, v_task_titles[v_idx], 'feature', v_state, null,
        null, auth.uid(), v_story.custom_status_id, v_story.swimlane_id
      )
      returning id into v_new_id;

      insert into public.story_labels (story_id, label_id)
      select v_new_id, label_id from public.story_labels where story_id = p_story_id;

      v_new_ids := v_new_ids || v_new_id;
    end loop;

    -- Into the gap the shift opened, in task order. Only ever lowers a
    -- position: the loop just advanced the sequence k times, so
    -- v_story.position + k - 1 is below the new frontier.
    update public.stories s
      set position = v_story.position + t.ord - 1
      from unnest(v_new_ids) with ordinality as t(id, ord)
      where s.id = t.id;
  end if;

  -- Bespoke activity_logs row (see 20260710000001): the trigger only covers
  -- INSERT/UPDATE, never the DELETE below, so the promotion needs its own row.
  insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
  values (
    v_story.project_id, null, auth.uid(), 'story.promoted_to_epic',
    jsonb_build_object(
      'epic_id', v_epic_id,
      'title', v_story.title,
      'task_count', v_task_count,
      'new_story_ids', to_jsonb(v_new_ids)
    )
  );

  delete from public.stories where id = p_story_id;

  -- Compaction runs AFTER the delete: before it, the first task-story and the
  -- original story both sit at v_story.position and the tie would be broken by
  -- id, which could rank the doomed row first and shift the survivors wrong.
  with merged as (
    select 'story'::text as kind, id, position from public.stories
      where project_id = v_story.project_id
    union all
    select 'divider'::text as kind, id, position from public.backlog_dividers
      where project_id = v_story.project_id
  ),
  ranked as (
    select kind, id, row_number() over (order by position, kind, id) - 1 as rn from merged
  ),
  compact_stories as (
    update public.stories s set position = r.rn
      from ranked r
      where r.kind = 'story' and s.id = r.id and s.position is distinct from r.rn
      returning 1
  )
  update public.backlog_dividers d set position = r.rn
    from ranked r
    where r.kind = 'divider' and d.id = r.id and d.position is distinct from r.rn;

  return jsonb_build_object('epic_id', v_epic_id, 'story_ids', v_new_ids);
end;
$$;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- restore promote_story_to_epic from 20260715000006_activity_logs_integrity.sql
