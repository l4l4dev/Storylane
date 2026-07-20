-- ============================================================
-- TASK-86 (doc-8 §7): person-day capacity snapshot.
--
-- `iterations.capacity` is written exactly once, by finalize_iteration, and
-- never recomputed — later membership or calendar edits must not rewrite
-- finished history (spec/velocity.md). The rate is a ratio of sums over the
-- window, so the window filter needs a way to exclude rows that carry no
-- real capacity: NULL (finalized before this migration) and 0 (gap rows the
-- catch-up loop generates) are both excluded by `capacity > 0`.
-- ============================================================

alter table public.iterations
  add column capacity numeric
    check (capacity is null or capacity >= 0);

-- `iterations` UPDATE RLS (20260627000004_iterations.sql) is row-level and
-- unconditional for owner/member, and RLS cannot restrict columns — so
-- without this guard any member could PATCH a finished iteration's snapshot
-- straight through PostgREST, and the "written once, never recomputed"
-- invariant above would be a comment rather than a rule.
--
-- Not merely the pre-existing `velocity` exposure repeated: capacity is the
-- DENOMINATOR of `rate = Σpoints / Σcapacity`, so one tiny forged value on
-- one past iteration inflates the rate — and therefore the auto-assignment
-- budget of every future sprint — for the whole project.
--
-- Keyed on OLD.state so it never blocks finalization itself: finalize's
-- update carries `where state <> 'done'`, so the row is still open at the
-- moment the snapshot is written. `goal` stays editable on a done row (the
-- only column clients actually update there).
create or replace function public.reject_finalized_iteration_metric_edit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'A finished iteration''s velocity and capacity are snapshots and cannot be edited'
    using errcode = 'P0001';
end;
$$;

revoke execute on function public.reject_finalized_iteration_metric_edit() from public, anon, authenticated;

create trigger iterations_reject_finalized_metric_edit
  before update on public.iterations
  for each row
  when (old.state = 'done'
        and (new.velocity is distinct from old.velocity
             or new.capacity is distinct from old.capacity))
  execute function public.reject_finalized_iteration_metric_edit();

-- Σ over current project members of their working days in [p_start, p_end],
-- minus personal time off. Split out from finalize_iteration so the shared
-- fixture (spec/fixtures/capacity.json) can call it directly and be
-- cross-checked against the TS implementation in packages/core.
--
-- No joined_at proration: doc-8 §7 is "the member set at finalize time ×
-- every working day of the sprint", matching the snapshot-at-that-moment
-- philosophy of the column itself.
--
-- `viewer` is excluded: a viewer cannot be assigned a story, so counting
-- their days would inflate the denominator of rate = Σpoints / Σcapacity and
-- silently under-forecast every future sprint. Written as an allowlist so a
-- role added later has to opt in rather than land in the math by default.
create or replace function public.project_capacity(
  p_project_id uuid,
  p_start date,
  p_end date
)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  with working_days as (
    select d::date as date
      from public.projects p
      cross join generate_series(p_start, p_end, interval '1 day') as d
      left join public.project_calendar_exceptions e
        on e.project_id = p.id and e.date = d::date
     where p.id = p_project_id
       and e.kind is distinct from 'holiday'
       -- `= any(working_weekdays)` treats the array as a set, so the
       -- duplicate entries TASK-85's CHECK cannot reject are harmless.
       and (e.kind = 'extra_workday'
            or extract(isodow from d)::int = any (p.working_weekdays))
  )
  select coalesce(count(*), 0)::numeric
    from working_days w
    cross join public.project_members m
   where m.project_id = p_project_id
     and m.role in ('owner', 'member')
     and not exists (
       select 1 from public.user_time_off t
        where t.user_id = m.user_id and t.date = w.date
     );
$$;

-- No client calls this directly: finalize_iteration (SECURITY DEFINER) is
-- its only caller, and planning capacity for *future* sprints is computed
-- client-side by packages/core. service_role keeps it only so the fixture
-- integration test can assert the two implementations agree.
revoke execute on function public.project_capacity(uuid, date, date) from public, anon, authenticated;
grant execute on function public.project_capacity(uuid, date, date) to service_role;

-- Unchanged from 20260719000010_reanchor_finalize_iteration.sql except for
-- the capacity snapshot (v_capacity) and its addition to the 'finalized'
-- event payload.
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
          'capacity', v_capacity, 'skipped', v_skip
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
-- (restore finalize_iteration from 20260719000010_reanchor_finalize_iteration.sql)
-- drop trigger iterations_reject_finalized_metric_edit on public.iterations;
-- drop function public.reject_finalized_iteration_metric_edit();
-- drop function public.project_capacity(uuid, date, date);
-- alter table public.iterations drop column capacity;
