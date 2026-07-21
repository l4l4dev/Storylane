-- ============================================================
-- TASK-87 (doc-8 §3-§5): flexible cadence.
--   1. iteration_length is changeable any time, down to 1 day; the change
--      applies to the next iteration row created, never to existing ones.
--   2. Per-sprint manual override of the current iteration's end date.
--   3. 1-day cadence lands on working days per the PROJECT calendar only.
--   4. A per-project display term for "Iteration".
-- ============================================================

-- The loop in finalize_iteration derives the next start from the previous
-- end (`end + 1`); a length < 1 makes end < start, so a neglected project
-- would generate rows without ever reaching today. The anon key lets an
-- owner PATCH this column directly, so the bound cannot live in the server
-- action alone. Upper bound is arbitrary but keeps a typo from generating a
-- decade-long sprint.
alter table public.projects
  add constraint projects_iteration_length_range
    check (iteration_length between 1 and 90);

-- Free text (doc-8 §5): teams say Sprint, Cycle, Week. Trimmed non-empty so
-- the UI never has to render a blank heading.
alter table public.projects
  add column iteration_term text not null default 'Iteration'
    check (length(btrim(iteration_term)) between 1 and 30);

-- ------------------------------------------------------------
-- Cadence change is recorded by a trigger, not by the server action, so
-- MCP/iOS/PostgREST writes are all covered by the one recording path
-- (ARCHITECTURE.md: clients never insert activity_logs directly).
-- story_id stays null — activity_logs is already project-scoped and its
-- story_id is nullable for exactly this kind of project-level event.
-- ------------------------------------------------------------
create or replace function public.log_project_cadence_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity_logs (project_id, actor_id, action, payload)
  values (
    new.id, coalesce(auth.uid(), new.created_by),
    'project.cadence_changed',
    jsonb_build_object('from', old.iteration_length, 'to', new.iteration_length)
  );
  return new;
end;
$$;

revoke execute on function public.log_project_cadence_change() from public, anon, authenticated;

create trigger projects_log_cadence_change
  after update on public.projects
  for each row
  when (new.iteration_length is distinct from old.iteration_length)
  execute function public.log_project_cadence_change();

-- ------------------------------------------------------------
-- First working day on or after p_from, per the PROJECT calendar only —
-- user_time_off is deliberately not consulted: one member's absence must
-- never make an iteration exist for the rest of the team on a different day
-- (TASK-85 header note).
--
-- The 366-day window bounds the scan; a project whose calendar has no
-- working day in a whole year returns null and callers fall back to the
-- unadjusted date, which keeps the rollover loop advancing.
-- ------------------------------------------------------------
create or replace function public.next_working_day(
  p_project_id uuid,
  p_from date
)
returns date
language sql
stable
-- Same reasoning as project_capacity: INVOKER is inert because the only
-- caller is finalize_iteration (postgres, SECURITY DEFINER).
security invoker
set search_path = public
as $$
  select d::date
    from public.projects p
    cross join generate_series(p_from, p_from + 366, interval '1 day') as d
    left join public.project_calendar_exceptions e
      on e.project_id = p.id and e.date = d::date
   where p.id = p_project_id
     and e.kind is distinct from 'holiday'
     -- `= any(working_weekdays)` treats the array as a set, so the duplicate
     -- entries TASK-85's CHECK cannot reject are harmless.
     and (e.kind = 'extra_workday'
          or extract(isodow from d)::int = any (p.working_weekdays))
   order by d
   limit 1;
$$;

revoke execute on function public.next_working_day(uuid, date) from public, anon, authenticated;
grant execute on function public.next_working_day(uuid, date) to service_role;

-- ------------------------------------------------------------
-- Per-sprint override (doc-8 §4): stretch or shorten the open iteration
-- without touching the project's cadence. SECURITY DEFINER because TASK-86
-- revoked table-level UPDATE on iterations from authenticated (only
-- `update (goal)` remains), and it takes the same advisory lock
-- finalize_iteration does so an override and a concurrent rollover cannot
-- interleave into inconsistent boundaries.
--
-- Only the end date moves. Shifting start_date would either overlap the
-- previous iteration or leave a gap, and whole-week overrides are expressed
-- by the caller choosing an end date that preserves the start weekday.
--
-- Two bounds, both enforced here rather than in the web action alone (a
-- client-side guard protects neither iOS nor a direct PostgREST call):
--   * not before today — an end date in the past makes the next lazy
--     rollover finalize the iteration, which would turn this into a "Finish
--     iteration" with none of its confirmation.
--   * at most 90 days long — the same ceiling projects.iteration_length
--     carries. A mistyped year would otherwise snapshot a capacity spanning
--     centuries and wreck the velocity rate for the whole project.
-- ------------------------------------------------------------
create or replace function public.override_iteration_length(
  p_iteration_id uuid,
  p_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_number int;
  v_start_date date;
  v_old_end_date date;
  v_state text;
begin
  if p_end_date is null then
    raise exception 'An end date is required';
  end if;

  select project_id, number into v_project_id, v_number
    from public.iterations where id = p_iteration_id;

  if v_project_id is null then
    raise exception 'Iteration not found';
  end if;

  if coalesce(public.project_role(v_project_id), '') not in ('owner', 'member') then
    raise exception 'Only project owners or members can change an iteration''s length';
  end if;

  perform pg_advisory_xact_lock(hashtext('iteration_finalize:' || v_project_id::text));

  -- Re-read under the lock: a rollover racing this call may have finished
  -- the row (and started its successor) since the membership check above.
  select start_date, end_date, state into v_start_date, v_old_end_date, v_state
    from public.iterations where id = p_iteration_id;

  if v_state = 'done' then
    return jsonb_build_object('kind', 'noop', 'reason', 'already_finished', 'project_id', v_project_id);
  end if;

  if p_end_date < greatest(v_start_date, (now() at time zone 'utc')::date) then
    raise exception 'The end date cannot be before the start date or in the past';
  end if;

  if p_end_date > v_start_date + 89 then
    raise exception 'An iteration cannot run longer than 90 days';
  end if;

  -- Re-sending the current end date is not a boundary move, so it writes no
  -- history. The rule lives here rather than in the web editor because iOS,
  -- the MCP bot and any direct RPC call reach this same path.
  if p_end_date = v_old_end_date then
    return jsonb_build_object(
      'kind', 'unchanged', 'number', v_number,
      'project_id', v_project_id, 'end_date', p_end_date
    );
  end if;

  update public.iterations set end_date = p_end_date where id = p_iteration_id;

  -- Recorded for the same reason a cadence change is: this moves a live
  -- sprint boundary and every boundary after it, so "who stretched this
  -- sprint" has to be answerable. No trigger can do it — the column grant
  -- makes this RPC the only path that ever writes end_date, so an UPDATE
  -- trigger would only ever fire from here anyway.
  insert into public.activity_logs (project_id, actor_id, action, payload)
  values (
    -- auth.uid() unqualified, unlike log_project_cadence_change's coalesce:
    -- the project_role() gate above cannot pass for a null auth.uid() (the
    -- project_members lookup compares user_id = NULL), so an unattended
    -- caller never reaches this insert.
    v_project_id, auth.uid(), 'iteration.length_overridden',
    jsonb_build_object('number', v_number, 'from', v_old_end_date, 'to', p_end_date)
  );

  return jsonb_build_object(
    'kind', 'overridden', 'number', v_number,
    'project_id', v_project_id, 'end_date', p_end_date
  );
end;
$$;

revoke execute on function public.override_iteration_length(uuid, date) from public, anon;
-- No service_role grant: the project_role() gate makes this RPC callable only
-- as a signed-in member, so granting it would advertise an unattended path
-- that does not work.
grant execute on function public.override_iteration_length(uuid, date) to authenticated;

-- ------------------------------------------------------------
-- finalize_iteration: unchanged from 20260720000002_iteration_capacity.sql
-- except that the next row's start/end are now computed in one place, with
-- the 1-day cadence landing on working days (doc-8 §3). A Friday iteration
-- in a Mon-Fri project therefore spans Fri-Sun: end_date is the day before
-- the next working day, so no day is left uncovered by any iteration.
--
-- Calendar edits never move an existing row — the adjustment happens only
-- while a row is being created.
-- ------------------------------------------------------------
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
  v_capacity numeric;
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
-- (restore finalize_iteration from 20260720000002_iteration_capacity.sql)
-- drop function public.override_iteration_length(uuid, date);
-- drop function public.next_working_day(uuid, date);
-- drop trigger projects_log_cadence_change on public.projects;
-- drop function public.log_project_cadence_change();
-- alter table public.projects drop column iteration_term;
-- alter table public.projects drop constraint projects_iteration_length_range;
