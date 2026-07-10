-- ============================================================
-- TASK-13: Promote story to Epic (spec/features.md "Promote to Epic").
-- Advisor-reviewed 2026-07-10.
--
-- A single atomic RPC: the story's title/description become a new epic,
-- each of its tasks becomes a new unestimated feature story linked to that
-- epic (at the original story's backlog position, preserving task order,
-- labels copied), and the original story is deleted.
--
-- Invoker rights (no SECURITY DEFINER): stories DELETE is already
-- owner-only (see 20260627000005_stories_tasks.sql), so promotion is
-- implicitly owner-gated by RLS the same way plain delete is — every
-- sub-operation here (epics INSERT, the position-shift UPDATE, stories
-- INSERT with created_by = auth.uid(), story_labels, activity_logs INSERT)
-- already passes RLS for an owner, same as update_story (20260708000003).
-- ============================================================

create or replace function public.promote_story_to_epic(p_story_id uuid)
returns jsonb
language plpgsql
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
  -- Plain (unlocked) read first, deliberately before any FOR UPDATE: Postgres
  -- RLS requires a locked SELECT to also satisfy the table's UPDATE policy,
  -- not just its SELECT policy. Stories' UPDATE policy only passes
  -- unconditionally for an owner (a plain member needs created_by/
  -- assignee_id = auth.uid() too) — locking first would make a non-owner
  -- member's call fail the lock with a misleading "Story not found" instead
  -- of the clear ownership error below, even though they can SELECT the row
  -- fine. Confirm the caller is an owner first, then lock.
  select * into v_story from public.stories where id = p_story_id;
  if not found then
    raise exception 'Story not found';
  end if;

  -- project_role() returns SQL NULL (not a role) for a non-member, and
  -- `NULL <> 'owner'` is NULL which `if` treats as false — coalesce so a
  -- non-member can't silently slip through (same bug class fixed twice
  -- already in finalize_iteration/invite_member).
  if coalesce(public.project_role(v_story.project_id), '') <> 'owner' then
    raise exception 'Only project owners can promote a story to an epic';
  end if;

  -- Same lock key assign_story_number() takes on every story INSERT
  -- (20260707000004) — serializes this promote against concurrent
  -- promotes/inserts in the same project so the position-shift UPDATE
  -- below can't race with another promote's shift and deadlock.
  perform pg_advisory_xact_lock(hashtext('story_number:' || v_story.project_id::text));

  -- Re-read with a lock now that the caller is a confirmed owner (whose
  -- UPDATE policy passes unconditionally, so the lock itself can't be
  -- filtered out the way it would for a non-owner) — closes the narrow race
  -- where the story was deleted between the unlocked read above and here.
  select * into v_story from public.stories where id = p_story_id for update;
  if not found then
    raise exception 'Story not found';
  end if;

  -- Locks the story's tasks (order-preserving array_agg, not reliant on
  -- unguaranteed row order) before counting them, so a concurrent task
  -- insert/delete on this same story (tasks INSERT/DELETE only requires
  -- owner/member, not this promote's owner-only gate) can't desync the
  -- position-shift amount below from what the loop actually creates.
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
    -- Icebox stories are 'unscheduled'; everything else becomes
    -- 'unstarted' — never inherits started/finished/etc, since an
    -- unestimated feature can't be started (spec/features.md line 29).
    v_state := case when v_story.state = 'unscheduled' then 'unscheduled' else 'unstarted' end;

    -- A done iteration rejects new story assignment (stories_reject_done_
    -- iteration_insert, 20260709000002) — an accepted story keeps its
    -- iteration_id after finalization, so copying it verbatim here would
    -- raise on insert. Drop back to the backlog in that case.
    select state into v_iter_state from public.iterations where id = v_story.iteration_id;
    v_iteration := case when v_iter_state = 'done' then null else v_story.iteration_id end;

    -- Makes exact room for v_task_count new stories replacing the one
    -- original (net +{v_task_count - 1} slots); position ties are already
    -- tolerated elsewhere (id tiebreak), so no other renumbering needed.
    update public.stories
    set position = position + (v_task_count - 1)
    where project_id = v_story.project_id and position > v_story.position;

    for v_idx in 1..v_task_count loop
      insert into public.stories (
        project_id, iteration_id, epic_id, title, story_type, state, points,
        position, assignee_id, created_by, custom_status_id, swimlane_id
      ) values (
        v_story.project_id, v_iteration, v_epic_id, v_task_titles[v_idx], 'feature', v_state, null,
        v_story.position + v_idx - 1, null, auth.uid(), v_story.custom_status_id, v_story.swimlane_id
      )
      returning id into v_new_id;

      insert into public.story_labels (story_id, label_id)
      select v_new_id, label_id from public.story_labels where story_id = p_story_id;

      v_new_ids := v_new_ids || v_new_id;
    end loop;
  end if;

  -- Bespoke activity_logs row: the sole exception to "clients never insert
  -- activity_logs directly" (ARCHITECTURE.md) — the normal trigger only
  -- covers stories INSERT/UPDATE, never DELETE, so without this the
  -- original story's disappearance (and the new stories' simultaneous
  -- appearance, each separately logged as 'story.created' by the existing
  -- trigger) would have no record explaining why.
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

  return jsonb_build_object('epic_id', v_epic_id, 'story_ids', v_new_ids);
end;
$$;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.promote_story_to_epic(uuid);
