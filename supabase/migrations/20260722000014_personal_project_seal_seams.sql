-- ============================================================
-- TASK-147 (owner decision 2026-07-22, follow-up to doc-15): seal the hidden
-- personal project's remaining seams. Two SECURITY DEFINER RPCs get an
-- is_personal rejection, and project_members' direct-INSERT bypass is locked
-- down to RPC-only, matching this session's established pattern (TASK-110
-- iterations, TASK-115 project_states).
-- ============================================================

-- ------------------------------------------------------------
-- promote_story_to_epic: full replacement, is_personal rejection added at the
-- top. The existing guard (project_role = 'owner') does not block this: the
-- personal project's creator is always its sole owner, so nothing stopped
-- them from promoting their own personal task. This DELETEs the source story
-- (see the delete near the bottom of this function, unchanged), which
-- CASCADEs my_work_story_state.story_id and story_completions.story_id
-- (both `on delete cascade`, 20260722000002_my_work_data_model.sql) —
-- permanent loss of the task's My Work placement AND its Done-log history.
-- The guard is server-side (not just hidden in the UI) because that cascade
-- is irreversible and this RPC is reachable directly via PostgREST.
-- Everything else in the body is verbatim from 20260719000011.
-- ------------------------------------------------------------
create or replace function public.promote_story_to_epic(p_story_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_story       public.stories%rowtype;
  v_is_personal boolean;
  v_task_count  int;
  v_task_ids    uuid[];
  v_task_titles text[];
  v_epic_id     uuid;
  v_new_ids     uuid[] := '{}';
  v_new_id      uuid;
  v_idx         int;
begin
  select * into v_story from public.stories where id = p_story_id;
  if not found then
    raise exception 'Story not found';
  end if;

  if coalesce(public.project_role(v_story.project_id), '') <> 'owner' then
    raise exception 'Only project owners can promote a story to an epic';
  end if;

  select is_personal into v_is_personal from public.projects where id = v_story.project_id;
  if v_is_personal then
    raise exception 'Personal tasks cannot be promoted to an epic' using errcode = 'P0001';
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
    update public.stories
    set position = position + (v_task_count - 1)
    where project_id = v_story.project_id and position > v_story.position;

    update public.backlog_dividers
    set position = position + (v_task_count - 1)
    where project_id = v_story.project_id and position > v_story.position;

    for v_idx in 1..v_task_count loop
      -- state_id and iteration_id both omitted: always lands in the Icebox
      -- (doc-8 Icebox=NULL), regardless of the original story's state or
      -- iteration — Icebox never carries an iteration_id
      -- (spec/data-model.md "Backlog zone predicate"), which
      -- finalize_iteration's rollover query assumes holds unconditionally.
      insert into public.stories (
        project_id, epic_id, title, story_type, points,
        assignee_id, created_by
      ) values (
        v_story.project_id, v_epic_id, v_task_titles[v_idx], 'feature', null,
        null, auth.uid()
      )
      returning id into v_new_id;

      insert into public.story_labels (story_id, label_id)
      select v_new_id, label_id from public.story_labels where story_id = p_story_id;

      v_new_ids := v_new_ids || v_new_id;
    end loop;

    update public.stories s
      set position = v_story.position + t.ord - 1
      from unnest(v_new_ids) with ordinality as t(id, ord)
      where s.id = t.id;
  end if;

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

-- ------------------------------------------------------------
-- invite_member: full replacement, is_personal rejection added. The personal
-- project must stay single-user forever (My Work's whole model assumes it);
-- without this, its owner could invite anyone via a direct RPC call (no UI
-- ever offers it, but nothing blocked the call itself). Body otherwise
-- verbatim from 20260717000001.
-- ------------------------------------------------------------
create or replace function public.invite_member(p_project_id uuid, p_user_id uuid, p_role text default 'member')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_personal boolean;
begin
  perform public.require_project_role(p_project_id, 'owner');

  select is_personal into v_is_personal from public.projects where id = p_project_id;
  if v_is_personal then
    raise exception 'The personal project cannot have members invited' using errcode = 'P0001';
  end if;

  if p_role not in ('owner', 'member', 'viewer') then
    raise exception 'Invalid role: %', p_role;
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'No such user';
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (p_project_id, p_user_id, p_role)
  on conflict (project_id, user_id) do nothing;

  if not found then
    raise exception 'That user is already a member of this project';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- project_members direct INSERT lockdown: no legitimate client path exists
-- (invite_member is the only real caller — grepped every
-- .from("project_members").insert(...) site in apps/web; the only hits are
-- service-role test fixtures). The same "administrative writes are RPC-only"
-- shape as TASK-110 (iterations) / TASK-115 (project_states): drop the
-- redundant policy AND revoke the grant (belt-and-suspenders — ENABLE RLS +
-- no policy already defaults to deny, but the grant-layer revoke makes the
-- "INSERT is RPC-only" intent explicit there too, not just in the policy).
-- invite_member is SECURITY DEFINER, so it is unaffected by this revoke.
-- ------------------------------------------------------------
drop policy "owners can add members" on public.project_members;
revoke insert on public.project_members from authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- grant insert on public.project_members to authenticated;
-- create policy "owners can add members" on public.project_members
--   for insert to authenticated with check (public.project_role(project_id) = 'owner');
-- (restore promote_story_to_epic from 20260719000011_reanchor_story_ops.sql,
--  invite_member from 20260717000001_guard_helpers.sql)
