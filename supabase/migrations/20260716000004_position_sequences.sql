-- ============================================================
-- TASK-58 slice 2a: allocate `position` from a per-table sequence.
-- Advisor-approved (Fable, 2026-07-16) — supersedes the RPC-per-table design
-- in the task body's item 2.
--
-- Every append-style insert derived its position in TS as
-- `max(position) + 1` over a separately-read snapshot, so two concurrent
-- creates in the same scope read the same max and wrote the same position.
--
-- Why a sequence default rather than an RPC: `position` is an ORDERING key,
-- not a dense one — densification is already owned by the rewrite paths
-- (_splice_backlog, move_story_board, swap_adjacent), which renumber a zone
-- 0..n-1 under the `positions:` advisory lock. nextval is monotonic, so a
-- default-allocated position always sorts after every previously issued one
-- (= append) and never collides with a rewrite, which only moves values down.
-- A sequence also holds for clients that bypass the RPCs (iOS inserting
-- directly); an RPC would only hold for callers that remember to use it.
--
-- Gaps are expected and harmless: nextval does not roll back, and the zone
-- rewrites re-densify on the next reorder. Nothing reads position as an index.
--
-- backlog_dividers is deliberately absent: its only insert path is
-- insert_board_item, which writes a placeholder 0 and splices under the lock
-- in the same transaction. It shares the backlog's position space with
-- stories, so a private sequence would be misleading.
-- ============================================================

do $$
declare
  v_table text;
  v_next int;
begin
  foreach v_table in array array['stories', 'tasks', 'epics', 'custom_statuses', 'swimlanes']
  loop
    execute format(
      'create sequence public.%I_position_seq as integer owned by public.%I.position',
      v_table, v_table
    );
    -- Start above every position in use, per table. The sequence is global to
    -- the table while positions are scoped (per project / per story), so this
    -- is deliberately conservative: scopes share one ascending space, which
    -- costs only gaps.
    execute format('select coalesce(max(position), 0) + 1 from public.%I', v_table) into v_next;
    execute format('select setval(%L, %s, false)', 'public.' || v_table || '_position_seq', v_next);
    execute format(
      'alter table public.%I alter column position set default nextval(%L)',
      v_table, 'public.' || v_table || '_position_seq'
    );
  end loop;
end;
$$;

-- 20260630000002_grants.sql already grants usage on all current + future
-- sequences to authenticated (and 20260707000006 to service_role), but the
-- default only fires for sequences created by the role that set it. Grant
-- explicitly so an insert can never fail on sequence permission.
grant usage, select on sequence
  public.stories_position_seq,
  public.tasks_position_seq,
  public.epics_position_seq,
  public.custom_statuses_position_seq,
  public.swimlanes_position_seq
  to authenticated, service_role;

-- generate_recurring_stories allocated max(position)+1 with no lock (the last
-- unlocked max+1 in the DB). Re-created verbatim except that the insert now
-- omits position and lets the sequence assign it.
create or replace function public.generate_recurring_stories(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  r record;
  v_due date;
  v_month_start date;
  v_month_end date;
  v_status_id uuid;
  v_claimed_count int;
begin
  if not public.is_project_member(p_project_id) then
    raise exception 'Not a member of this project';
  end if;

  for r in
    select * from public.recurring_stories
    where project_id = p_project_id and is_active
  loop
    -- Most recent occurrence <= today for this rule's cadence.
    if r.cadence = 'daily' then
      v_due := v_today;
    elsif r.cadence = 'weekly' then
      v_due := v_today - (((extract(dow from v_today)::int - r.weekday) + 7) % 7);
    else -- monthly, day_of_month > 28 clamps to month end (spec/data-model.md)
      v_month_start := date_trunc('month', v_today)::date;
      v_month_end := (v_month_start + interval '1 month' - interval '1 day')::date;
      v_due := least(v_month_start + (r.day_of_month - 1), v_month_end);
      if v_due > v_today then
        v_month_start := date_trunc('month', v_month_start - interval '1 day')::date;
        v_month_end := (v_month_start + interval '1 month' - interval '1 day')::date;
        v_due := least(v_month_start + (r.day_of_month - 1), v_month_end);
      end if;
    end if;

    if r.last_generated_on is not null and r.last_generated_on >= v_due then
      continue;
    end if;

    -- Resolve the effective target column before claiming (AC #7: a card
    -- must not be born completed) — the 20260709000005_free_mode_completed_at.sql
    -- trigger stamps completed_at on insert into an is_done column, so a
    -- rule whose target was toggled is_done after creation must fall back,
    -- not generate a born-completed card. Resolved before the claim so an
    -- unresolvable rule (no non-done column exists) is skipped without
    -- burning the occurrence — it stays due next time a column exists.
    select cs.id into v_status_id
      from public.custom_statuses cs
      where cs.id = r.custom_status_id and cs.project_id = p_project_id and not cs.is_done;

    if v_status_id is null then
      select cs.id into v_status_id
        from public.custom_statuses cs
        where cs.project_id = p_project_id and not cs.is_done
        order by cs.position asc
        limit 1;
    end if;

    if v_status_id is null then
      continue;
    end if;

    update public.recurring_stories
      set last_generated_on = v_due
      where id = r.id
        and (last_generated_on is null or last_generated_on < v_due);
    get diagnostics v_claimed_count = row_count;

    if v_claimed_count > 0 then
      insert into public.stories (project_id, title, description, story_type, custom_status_id, swimlane_id)
        values (p_project_id, r.title, r.description, 'feature', v_status_id, r.swimlane_id);
    end if;
  end loop;
end;
$$;

-- move_story_to_project / copy_story_to_project were the last max+1 writers on
-- stories.position. They hold only the `story_number:` lock (for number
-- allocation), not `positions:`, so their max+1 could read a sequence-issued
-- value and re-issue it — the one path able to overtake the sequence frontier
-- and break the invariant above. Re-created from the CURRENT definitions in
-- 20260715000001_archive_favorites.sql (which superseded 20260711000001), with
-- the position allocation removed and everything else word-for-word: the
-- insert+delete shape, the untouched project_id, the story_number lock and the
-- task/comment re-parenting are the Move/Copy hardening contract
-- (spec/features.md "Move / Copy") and are not in scope here.
create or replace function public.move_story_to_project(p_story_id uuid, p_target_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_story           public.stories%rowtype;
  v_source_archived timestamptz;
  v_target_mode     text;
  v_point_scale     text;
  v_custom_pts      int[];
  v_target_archived timestamptz;
  v_status_id       uuid;
  v_points          int;
  v_assignee        uuid;
  v_new_id          uuid;
  v_new_number      int;
  v_label           record;
  v_target_label    uuid;
begin
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

  select archived_at into v_source_archived from public.projects where id = v_story.project_id;
  if v_source_archived is not null then
    raise exception 'Source project is archived';
  end if;

  select workflow_mode, point_scale, custom_points, archived_at
    into v_target_mode, v_point_scale, v_custom_pts, v_target_archived
    from public.projects where id = p_target_project_id;
  if v_target_archived is not null then
    raise exception 'Target project is archived';
  end if;

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
    project_id, title, description, story_type, state, points,
    assignee_id, created_by, custom_status_id
  ) values (
    p_target_project_id, v_story.title, v_story.description, v_story.story_type,
    'unscheduled', v_points, v_assignee, auth.uid(), v_status_id
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

  delete from public.stories where id = p_story_id;

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

-- The tasks copy below keeps its explicit positions: it reproduces the source
-- story's existing task order inside a new scope, which is a rewrite, not an
-- append. A later addTask on the copy still lands after them (nextval exceeds
-- every value in the table).
create or replace function public.copy_story_to_project(p_story_id uuid, p_target_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_story           public.stories%rowtype;
  v_source_archived timestamptz;
  v_target_mode     text;
  v_point_scale     text;
  v_custom_pts      int[];
  v_target_archived timestamptz;
  v_status_id       uuid;
  v_points          int;
  v_assignee        uuid;
  v_new_id          uuid;
  v_new_number      int;
  v_label           record;
  v_target_label    uuid;
begin
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

  select archived_at into v_source_archived from public.projects where id = v_story.project_id;
  if v_source_archived is not null then
    raise exception 'Source project is archived';
  end if;

  select workflow_mode, point_scale, custom_points, archived_at
    into v_target_mode, v_point_scale, v_custom_pts, v_target_archived
    from public.projects where id = p_target_project_id;
  if v_target_archived is not null then
    raise exception 'Target project is archived';
  end if;

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
    project_id, title, description, story_type, state, points,
    assignee_id, created_by, custom_status_id
  ) values (
    p_target_project_id, v_story.title, v_story.description, v_story.story_type,
    'unscheduled', v_points, v_assignee, auth.uid(), v_status_id
  )
  returning id, number into v_new_id, v_new_number;

  insert into public.tasks (story_id, title, is_done, position)
  select v_new_id, title, is_done, position from public.tasks where story_id = p_story_id;

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
-- alter table public.stories alter column position set default 0;
-- alter table public.tasks alter column position set default 0;
-- alter table public.epics alter column position set default 0;
-- alter table public.custom_statuses alter column position set default 0;
-- alter table public.swimlanes alter column position set default 0;
-- drop sequence public.stories_position_seq, public.tasks_position_seq,
--   public.epics_position_seq, public.custom_statuses_position_seq,
--   public.swimlanes_position_seq;
-- (restore generate_recurring_stories from 20260709000008, and
--  move_story_to_project / copy_story_to_project from 20260715000001)
