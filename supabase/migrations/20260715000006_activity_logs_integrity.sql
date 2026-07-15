-- ============================================================
-- TASK-55 (2/3): activity_logs cross-project integrity + insert lockdown.
-- Advisor-approved design (Fable, 2026-07-12; task notes).
--
-- Codex (doc-1, Medium): activity_logs.project_id and story_id are
-- independent FKs, so a member could insert a log in project A referencing
-- project B's story. Two fixes:
--   1. A composite FK (story_id, project_id) -> stories(id, project_id) makes
--      a cross-project reference impossible (needs UNIQUE(id, project_id) on
--      stories as the target). The existing single-column
--      story_id -> stories(id) ON DELETE SET NULL FK is kept: on a story
--      delete it nulls story_id first, so the composite FK's row is no longer
--      checked (null component, MATCH SIMPLE) and the log survives with
--      project_id intact — verified empirically. The composite FK is
--      therefore ON DELETE NO ACTION.
--   2. Clients never insert activity_logs (ARCHITECTURE.md): the only insert
--      paths are the SECURITY DEFINER triggers (log_story_activity /
--      log_comment_activity), the move/copy RPCs (SECURITY DEFINER), and
--      promote_story_to_epic — which was SECURITY INVOKER and so needed the
--      client INSERT policy. Convert it to SECURITY DEFINER (its owner gate
--      and project-scoped writes are unchanged — same shape as move/copy),
--      then DROP the client INSERT policy so a direct client insert is denied.
-- ============================================================

-- FK target for the composite reference.
alter table public.stories
  add constraint stories_id_project_uk unique (id, project_id);

-- Backfill guard: refuse to add the FK if any existing row already violates
-- it (a cross-project reference from before this constraint existed).
do $$
begin
  if exists (
    select 1 from public.activity_logs a
    where a.story_id is not null
      and not exists (
        select 1 from public.stories s
        where s.id = a.story_id and s.project_id = a.project_id
      )
  ) then
    raise exception 'activity_logs has cross-project story references; resolve them before adding the composite FK';
  end if;
end $$;

-- The cross-project guard. NO ACTION (not SET NULL — that would also null the
-- NOT NULL project_id): story deletes are handled by the pre-existing
-- single-column story_id FK's SET NULL, which fires first.
alter table public.activity_logs
  add constraint activity_logs_story_project_fk
  foreign key (story_id, project_id)
  references public.stories (id, project_id)
  on delete no action;

-- promote_story_to_epic becomes SECURITY DEFINER so its bespoke activity_logs
-- insert (and all its other writes) no longer depend on the client INSERT
-- policy being dropped below. The owner gate (coalesce(project_role,'')<>'owner'
-- -> raise) still gates the whole function and every write stays scoped to the
-- checked project, exactly like the already-DEFINER move/copy RPCs. auth.uid()
-- still resolves to the caller under DEFINER (used for created_by/actor_id).
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

  return jsonb_build_object('epic_id', v_epic_id, 'story_ids', v_new_ids);
end;
$$;

-- All activity_logs writers are SECURITY DEFINER now, so no legitimate insert
-- needs this policy — drop it to deny direct client inserts (ARCHITECTURE.md:
-- the trigger/RPC paths are the single recording path).
drop policy "members can write activity" on public.activity_logs;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- create policy "members can write activity" on public.activity_logs
--   for insert to authenticated
--   with check (actor_id = auth.uid() and public.project_role(project_id) in ('owner','member'));
-- alter table public.activity_logs drop constraint activity_logs_story_project_fk;
-- alter table public.stories drop constraint stories_id_project_uk;
-- -- restore promote_story_to_epic WITHOUT security definer: re-run the
-- -- CREATE OR REPLACE from 20260710000001_promote_story_to_epic.sql verbatim
-- -- (its body is unchanged here except for the added `security definer` line).
