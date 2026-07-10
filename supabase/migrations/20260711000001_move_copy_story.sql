-- ============================================================
-- TASK-14: Move / Copy story to another project (spec/features.md
-- "Move / Copy to another project", hardening note 2026-07-08).
-- Advisor-reviewed 2026-07-11.
--
-- First RPCs in this codebase that read/write across two different
-- projects in one transaction. Both are SECURITY DEFINER (fixed
-- search_path, EXECUTE granted to `authenticated` only via the blanket
-- default-privileges grant in 20260630000002_grants.sql — no existing RPC
-- migration adds an explicit per-function grant/revoke, so this doesn't
-- either) with explicit membership re-checks inside, matching
-- finalize_iteration's style: RLS cannot express "member of two different
-- projects" row-by-row (spec/rls.md).
--
-- Never `UPDATE stories SET project_id`: pin_story_number() pins `number`
-- on UPDATE, so only a fresh INSERT into the target gets a correct
-- per-project number (assign_story_number() computes it, overwriting
-- anything supplied). `completed_at` is likewise left for
-- maintain_story_completed_at() to compute — landing in an `is_done`
-- free-mode column legitimately marks the story completed on arrival,
-- same as it would for any other insert into that column.
--
-- TODO(TASK-8): once projects.archived_at exists, re-check neither source
-- nor target project is archived before writing anything.
-- ============================================================

create or replace function public.move_story_to_project(p_story_id uuid, p_target_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_story        public.stories%rowtype;
  v_target_mode  text;
  v_point_scale  text;
  v_custom_pts   int[];
  v_status_id    uuid;
  v_position     int;
  v_points       int;
  v_assignee     uuid;
  v_new_id       uuid;
  v_new_number   int;
  v_label        record;
  v_target_label uuid;
begin
  -- Strong FOR UPDATE (not FOR NO KEY UPDATE): a concurrent INSERT of a
  -- task/comment against this story takes a FOR KEY SHARE lock on it via
  -- the FK, which this blocks until commit — after which the row is gone
  -- and their insert fails with a FK violation (the autosave "story
  -- deleted" path in spec/screens.md), so the tasks/comments re-parent
  -- below can never miss a row created mid-move.
  --
  -- Filtered by source membership in the same query (not a separate
  -- check afterward): being SECURITY DEFINER, this SELECT bypasses RLS
  -- entirely, so without the filter any authenticated caller could probe
  -- arbitrary story ids and learn whether they exist in projects they
  -- have no relationship to from the distinct "not found" vs "not a
  -- member" errors (rls-security-reviewer, 2026-07-11). Folding the check
  -- into the WHERE clause makes both cases raise the same generic error.
  select * into v_story from public.stories
    where id = p_story_id
      and project_id in (
        select project_id from public.project_members
        where user_id = auth.uid() and role in ('owner', 'member')
      )
    for update;
  if not found then
    raise exception 'Story not found';
  end if;

  if coalesce(public.project_role(p_target_project_id), '') not in ('owner', 'member') then
    raise exception 'Not a member of the target project';
  end if;
  if v_story.project_id = p_target_project_id then
    raise exception 'Source and target project must be different';
  end if;

  select workflow_mode, point_scale, custom_points
    into v_target_mode, v_point_scale, v_custom_pts
    from public.projects where id = p_target_project_id;

  -- Same lock assign_story_number() takes on the INSERT below — taken
  -- early so this move's own position lookup can't tie with a concurrent
  -- move/insert into the same target computing the same max(position)+1.
  perform pg_advisory_xact_lock(hashtext('story_number:' || p_target_project_id::text));

  -- Landing state is always 'unscheduled' regardless of mode: tracker
  -- reads it as Icebox; free mode ignores `state` entirely and a
  -- 'unstarted' placeholder would just make this the one row that
  -- differs from every other free-mode story's default (advisor note).
  if v_target_mode = 'free' then
    select id into v_status_id from public.custom_statuses
      where project_id = p_target_project_id order by position, id limit 1;
    if v_status_id is null then
      raise exception 'Target project has no board columns to land the story in';
    end if;
  else
    v_status_id := null;
  end if;

  select coalesce(max(position), -1) + 1 into v_position
    from public.stories where project_id = p_target_project_id;

  -- Points kept only if the value exists in the target's point scale
  -- (mirrors apps/web/lib/utils/stories.ts pointScaleValues — keep both in
  -- sync if either changes, no shared source of truth between TS/SQL).
  -- `custom_points` NULL is a legitimate custom-scale project with no
  -- values configured yet, not an error - falls through to 'not a member
  -- of the scale' like any other missing value.
  if v_story.points is null then
    v_points := null;
  else
    v_points := case v_point_scale
      when 'fibonacci' then (select v_story.points where v_story.points = any(array[0, 1, 2, 3, 5, 8, 13]))
      when 'linear' then (select v_story.points where v_story.points = any(array[0, 1, 2, 3]))
      when 'custom' then (select v_story.points where v_story.points = any(coalesce(v_custom_pts, '{}')))
    end;
  end if;

  v_assignee := case
    when v_story.assignee_id is not null and exists(
      select 1 from public.project_members
      where project_id = p_target_project_id and user_id = v_story.assignee_id
    ) then v_story.assignee_id
    else null
  end;

  insert into public.stories (
    project_id, title, description, story_type, state, points, position,
    assignee_id, created_by, custom_status_id
  ) values (
    p_target_project_id, v_story.title, v_story.description, v_story.story_type,
    'unscheduled', v_points, v_position, v_assignee, auth.uid(), v_status_id
  )
  returning id, number into v_new_id, v_new_number;

  update public.tasks set story_id = v_new_id where story_id = p_story_id;
  update public.comments set story_id = v_new_id where story_id = p_story_id;

  for v_label in
    select l.name, l.color from public.story_labels sl
    join public.labels l on l.id = sl.label_id
    where sl.story_id = p_story_id
  loop
    select id into v_target_label from public.labels
      where project_id = p_target_project_id and name = v_label.name
      order by id limit 1;

    if v_target_label is null then
      insert into public.labels (project_id, name, color)
      values (p_target_project_id, v_label.name, v_label.color)
      returning id into v_target_label;
    end if;

    insert into public.story_labels (story_id, label_id)
    values (v_new_id, v_target_label)
    on conflict (story_id, label_id) do nothing;
  end loop;

  -- Cascades the source's now-superseded story_labels rows; tasks/comments
  -- already re-parented above survive (their story_id no longer points here).
  delete from public.stories where id = p_story_id;

  -- Two bespoke rows (source + target), alongside move/copy's other
  -- exception to "clients never insert activity_logs directly"
  -- (ARCHITECTURE.md) — see promote_story_to_epic for the sibling case.
  -- The target INSERT above also fires the normal story.created trigger,
  -- same dual-logging precedent as promote.
  insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
  values (
    v_story.project_id, null, auth.uid(), 'story.moved_out',
    jsonb_build_object('target_project_id', p_target_project_id, 'title', v_story.title)
  );
  insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
  values (
    p_target_project_id, v_new_id, auth.uid(), 'story.moved_in',
    jsonb_build_object('source_project_id', v_story.project_id, 'title', v_story.title)
  );

  return jsonb_build_object('story_id', v_new_id, 'project_id', p_target_project_id, 'number', v_new_number);
end;
$$;

create or replace function public.copy_story_to_project(p_story_id uuid, p_target_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_story        public.stories%rowtype;
  v_target_mode  text;
  v_point_scale  text;
  v_custom_pts   int[];
  v_status_id    uuid;
  v_position     int;
  v_points       int;
  v_assignee     uuid;
  v_new_id       uuid;
  v_new_number   int;
  v_label        record;
  v_target_label uuid;
begin
  -- Filtered by source membership in the same query, same rationale as
  -- move_story_to_project (rls-security-reviewer, 2026-07-11): being
  -- SECURITY DEFINER, this SELECT bypasses RLS entirely, so without the
  -- filter "not found" vs "not a member" would leak whether the story
  -- exists in a project the caller has no relationship to.
  select * into v_story from public.stories
    where id = p_story_id
      and project_id in (
        select project_id from public.project_members
        where user_id = auth.uid() and role in ('owner', 'member')
      )
    for update;
  if not found then
    raise exception 'Story not found';
  end if;

  if coalesce(public.project_role(p_target_project_id), '') not in ('owner', 'member') then
    raise exception 'Not a member of the target project';
  end if;
  if v_story.project_id = p_target_project_id then
    raise exception 'Source and target project must be different';
  end if;

  select workflow_mode, point_scale, custom_points
    into v_target_mode, v_point_scale, v_custom_pts
    from public.projects where id = p_target_project_id;

  perform pg_advisory_xact_lock(hashtext('story_number:' || p_target_project_id::text));

  if v_target_mode = 'free' then
    select id into v_status_id from public.custom_statuses
      where project_id = p_target_project_id order by position, id limit 1;
    if v_status_id is null then
      raise exception 'Target project has no board columns to land the story in';
    end if;
  else
    v_status_id := null;
  end if;

  select coalesce(max(position), -1) + 1 into v_position
    from public.stories where project_id = p_target_project_id;

  if v_story.points is null then
    v_points := null;
  else
    v_points := case v_point_scale
      when 'fibonacci' then (select v_story.points where v_story.points = any(array[0, 1, 2, 3, 5, 8, 13]))
      when 'linear' then (select v_story.points where v_story.points = any(array[0, 1, 2, 3]))
      when 'custom' then (select v_story.points where v_story.points = any(coalesce(v_custom_pts, '{}')))
    end;
  end if;

  v_assignee := case
    when v_story.assignee_id is not null and exists(
      select 1 from public.project_members
      where project_id = p_target_project_id and user_id = v_story.assignee_id
    ) then v_story.assignee_id
    else null
  end;

  insert into public.stories (
    project_id, title, description, story_type, state, points, position,
    assignee_id, created_by, custom_status_id
  ) values (
    p_target_project_id, v_story.title, v_story.description, v_story.story_type,
    'unscheduled', v_points, v_position, v_assignee, auth.uid(), v_status_id
  )
  returning id, number into v_new_id, v_new_number;

  -- Copy duplicates task content verbatim (including is_done) — unlike
  -- Promote, spec does not ask for a reset here; this is a snapshot
  -- duplicate, not a fresh derived story.
  insert into public.tasks (story_id, title, is_done, position)
  select v_new_id, title, is_done, position from public.tasks where story_id = p_story_id;

  -- No comments, no history (spec) — source story is left untouched.

  for v_label in
    select l.name, l.color from public.story_labels sl
    join public.labels l on l.id = sl.label_id
    where sl.story_id = p_story_id
  loop
    select id into v_target_label from public.labels
      where project_id = p_target_project_id and name = v_label.name
      order by id limit 1;

    if v_target_label is null then
      insert into public.labels (project_id, name, color)
      values (p_target_project_id, v_label.name, v_label.color)
      returning id into v_target_label;
    end if;

    insert into public.story_labels (story_id, label_id)
    values (v_new_id, v_target_label)
    on conflict (story_id, label_id) do nothing;
  end loop;

  insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
  values (
    p_target_project_id, v_new_id, auth.uid(), 'story.copied_in',
    jsonb_build_object('source_project_id', v_story.project_id, 'source_story_id', p_story_id, 'title', v_story.title)
  );

  return jsonb_build_object('story_id', v_new_id, 'project_id', p_target_project_id, 'number', v_new_number);
end;
$$;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.copy_story_to_project(uuid, uuid);
-- drop function public.move_story_to_project(uuid, uuid);
