-- TASK-207: the burndown chart derives remaining points from
-- activity_logs.story.state_changed history, and needs two things this log
-- did not previously carry.
--
-- 1. Category at the time of the transition. story.state_changed only ever
--    stored resolved state NAMES (20260719000009, deliberately — so the log
--    stays readable if a state is renamed/deleted). But a state's category is
--    per-row IMMUTABLE (project_states_reject_category_change trigger,
--    20260719000005) while its NAME is freely editable, and a state can be
--    deleted and a differently-categorized state later created under the
--    same name. Resolving a historical log entry's category by looking up
--    the CURRENT project_states set by name can silently reclassify a past
--    transition. Fixed at the source: log_story_activity now also resolves
--    and stores from_category/to_category at transition time, alongside the
--    existing from/to names. Burndown code prefers these when present and
--    falls back to name-based lookup only for rows logged before this
--    migration.
--
-- 2. A visible trail for iteration rollover reparenting. finalize_iteration
--    moves an incomplete story's iteration_id forward to the next iteration
--    on rollover (a plain UPDATE, not itself observed by any trigger, per
--    ARCHITECTURE.md's activity_logs exception list) — so a past iteration's
--    burndown, computed by filtering stories on CURRENT iteration_id, loses
--    every story that has since rolled over out of it. finalize_iteration
--    now logs a 'story.iteration_rolled_over' row per reparented story
--    (same class of self-recorded event as move/copy's story.moved_out),
--    so a past iteration's story set can be reconstructed as "still points
--    here" UNION "rolled out of here per this log".

create or replace function public.log_story_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_name text;
  v_new_name text;
  v_old_category text;
  v_new_category text;
begin
  if tg_op = 'INSERT' then
    insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
    values (
      new.project_id, new.id, coalesce(auth.uid(), new.created_by),
      'story.created', jsonb_build_object('title', new.title)
    );
  elsif tg_op = 'UPDATE' and new.state_id is distinct from old.state_id then
    if old.state_id is not null then
      select name, category into v_old_name, v_old_category from public.project_states where id = old.state_id;
    end if;
    if new.state_id is not null then
      select name, category into v_new_name, v_new_category from public.project_states where id = new.state_id;
    end if;
    insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
    values (
      new.project_id, new.id, coalesce(auth.uid(), new.created_by),
      'story.state_changed',
      jsonb_build_object(
        'from', v_old_name, 'to', v_new_name,
        'from_category', v_old_category, 'to_category', v_new_category
      )
    );
  end if;
  return new;
end;
$$;

create or replace function public.finalize_iteration(
  p_project_id uuid,
  p_manual boolean,
  p_iteration_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_lock_key bigint := hashtext('iteration_finalize:' || p_project_id::text);
  -- Both paths are writer-only now (owner/member): manual finish always was,
  -- and lazy rollover is a write no viewer should trigger (owner decision,
  -- 20260722000012). One list for the pre- and post-lock assertion so they
  -- can't drift.
  v_roles text[] := array['owner', 'member'];
  v_iteration_length int;
  v_latest record;
  v_events jsonb := '[]'::jsonb;
  v_first boolean := true;
  v_velocity int;
  v_capacity numeric;
  v_next_number int;
  v_next_start date;
  v_next_end date;
  v_next_id uuid;
  v_pending_goal text;
  v_skip boolean;
begin
  perform public.require_project_role(p_project_id, variadic v_roles);

  if p_manual and p_iteration_id is null then
    raise exception 'Manual finish requires an iteration id';
  end if;

  perform pg_advisory_xact_lock(v_lock_key);

  -- Re-check authorization under the lock (TASK-142): the caller may have been
  -- de-membered while blocked waiting for it.
  perform public.require_project_role(p_project_id, variadic v_roles);

  select iteration_length into v_iteration_length
  from public.projects where id = p_project_id;

  if v_iteration_length is null then
    return v_events;
  end if;

  select id, number, start_date, end_date, state
    into v_latest
    from public.iterations
    where project_id = p_project_id
    order by number desc
    limit 1;

  if v_latest is null and p_manual then
    return v_events || jsonb_build_object('kind', 'noop', 'reason', 'nothing_to_finish');
  end if;

  if p_manual and (v_latest.id <> p_iteration_id or v_latest.state = 'done') then
    return v_events || jsonb_build_object('kind', 'noop', 'reason', 'already_finished');
  end if;

  loop
    v_skip := false;
    if v_latest is null then
      v_next_number := 1;
      v_next_start := v_today;
    elsif v_first and p_manual and v_latest.state <> 'done' then
      if v_latest.start_date <= v_today then
        update public.iterations
          set end_date = least(end_date, v_today)
          where id = v_latest.id and state <> 'done';
        v_latest.end_date := least(v_latest.end_date, v_today);
      else
        update public.iterations
          set end_date = start_date, skipped = true
          where id = v_latest.id and state <> 'done';
        v_latest.end_date := v_latest.start_date;
        v_skip := true;
      end if;
    elsif v_latest.state <> 'done' and v_latest.end_date >= v_today then
      exit;
    end if;

    if v_latest is not null then
      select coalesce(sum(s.points), 0) into v_velocity
        from public.stories s
        join public.project_states ps on ps.id = s.state_id
        where s.iteration_id = v_latest.id
          and ps.category = 'done'
          and s.story_type in ('feature', 'bug');

      -- Only the first pass finalizes an iteration the team actually worked
      -- in. Every later pass is a gap row this same call just inserted and
      -- immediately re-read as v_latest — a neglected project produces a
      -- whole chain of them. Giving those a real capacity would put
      -- points=0, capacity>0 rows in the rate window and crush the rate, so
      -- they are pinned to 0 and the window filter drops them.
      -- Computed here, after the manual-finish truncation above, so a
      -- shortened sprint gets the capacity of its actual length.
      v_capacity := case
        when v_first then public.project_capacity(p_project_id, v_latest.start_date, v_latest.end_date)
        else 0
      end;

      update public.iterations
        set state = 'done', velocity = v_velocity, capacity = v_capacity
        where id = v_latest.id and state <> 'done';

      if found then
        v_events := v_events || jsonb_build_object(
          'kind', 'finalized', 'number', v_latest.number, 'velocity', v_velocity,
          'capacity', v_capacity, 'skipped', v_skip, 'start_date', v_latest.start_date
        );
      end if;

      v_next_number := v_latest.number + 1;
      v_next_start := v_latest.end_date + 1;
    end if;

    if v_iteration_length = 1 then
      v_next_start := coalesce(public.next_working_day(p_project_id, v_next_start), v_next_start);
      v_next_end := coalesce(public.next_working_day(p_project_id, v_next_start + 1), v_next_start + 1) - 1;
    else
      v_next_end := v_next_start + (v_iteration_length - 1);
    end if;

    select goal into v_pending_goal
      from public.iteration_goals
      where project_id = p_project_id and number = v_next_number;

    insert into public.iterations (project_id, number, start_date, end_date, goal)
      values (p_project_id, v_next_number, v_next_start, v_next_end, v_pending_goal)
      returning id into v_next_id;

    if v_pending_goal is not null then
      delete from public.iteration_goals
        where project_id = p_project_id and number = v_next_number;
    end if;

    if v_latest is not null then
      -- One atomic statement, not an UPDATE followed by a separately
      -- re-evaluated INSERT predicate: a concurrent set_story_state or story
      -- insert landing between two independent statements (this project's
      -- advisory lock only serializes concurrent finalize_iteration calls,
      -- not ordinary story writes from another session) could otherwise log
      -- a rollover that never happened, or move a story with no log of it.
      -- Feeding the UPDATE's own RETURNING into the INSERT makes the logged
      -- set exactly the set actually moved, by construction.
      with moved as (
        update public.stories s
          set iteration_id = v_next_id
          where s.iteration_id = v_latest.id
            and not exists (
              select 1 from public.project_states ps
              where ps.id = s.state_id and ps.category = 'done'
            )
          returning s.id
      )
      insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
      select
        p_project_id, moved.id, auth.uid(), 'story.iteration_rolled_over',
        jsonb_build_object(
          'from_iteration_id', v_latest.id, 'to_iteration_id', v_next_id,
          'from_iteration_number', v_latest.number, 'to_iteration_number', v_next_number
        )
      from moved;
    end if;

    v_events := v_events || jsonb_build_object(
      'kind', 'started', 'number', v_next_number, 'start_date', v_next_start, 'end_date', v_next_end
    );

    select id, number, start_date, end_date, state
      into v_latest
      from public.iterations
      where id = v_next_id;
    v_first := false;
  end loop;

  return v_events;
end;
$$;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- (restore log_story_activity from 20260719000009_reanchor_activity_log.sql
--  and finalize_iteration from 20260722000012_finalize_iteration_writers_only.sql —
--  both are full-body replacements, verbatim except for the changes above)
