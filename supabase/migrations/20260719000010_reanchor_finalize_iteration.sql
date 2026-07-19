-- ============================================================
-- TASK-91: finalize_iteration re-anchored from stories.state = 'accepted'
-- (velocity) / stories.state <> 'accepted' (rollover carry-forward) onto
-- category = 'done' via project_states. Word-for-word from the current
-- body (20260715000002_skip_iteration.sql) otherwise — same 3-arg
-- signature, same skip/manual-finish/advisory-lock logic, untouched.
-- ============================================================

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
  v_iteration_length int;
  v_latest record;
  v_events jsonb := '[]'::jsonb;
  v_first boolean := true;
  v_velocity int;
  v_next_number int;
  v_next_start date;
  v_next_end date;
  v_next_id uuid;
  v_pending_goal text;
  v_skip boolean;
begin
  if p_manual then
    if coalesce(public.project_role(p_project_id), '') not in ('owner', 'member') then
      raise exception 'Only project owners or members can finish an iteration';
    end if;
    if p_iteration_id is null then
      raise exception 'Manual finish requires an iteration id';
    end if;
  else
    if not public.is_project_member(p_project_id) then
      raise exception 'Not a member of this project';
    end if;
  end if;

  perform pg_advisory_xact_lock(v_lock_key);

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
      v_next_end := v_today + (v_iteration_length - 1);
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

      update public.iterations
        set state = 'done', velocity = v_velocity
        where id = v_latest.id and state <> 'done';

      if found then
        v_events := v_events || jsonb_build_object(
          'kind', 'finalized', 'number', v_latest.number, 'velocity', v_velocity, 'skipped', v_skip
        );
      end if;

      v_next_number := v_latest.number + 1;
      v_next_start := v_latest.end_date + 1;
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
      -- Carry forward everything not in a done-category state (was
      -- `state <> 'accepted'`). A story with no state_id (Icebox) never has
      -- an iteration_id in the first place, so this predicate only ever
      -- touches real state_id rows — no NULL-handling change needed.
      update public.stories s
        set iteration_id = v_next_id
        where s.iteration_id = v_latest.id
          and not exists (
            select 1 from public.project_states ps
            where ps.id = s.state_id and ps.category = 'done'
          );
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
-- (restore finalize_iteration from 20260715000002_skip_iteration.sql —
-- references the dropped stories.state column and cannot run as-is)
