-- ============================================================
-- TASK-38: manually finishing a not-yet-started iteration = "skip".
-- Advisor-approved design (Fable, 2026-07-11; see the task notes).
--
-- Before this, manual finish was guarded on `start_date <= today`, so
-- pressing "Finish iteration" on a future-start current iteration (the
-- successor a prior manual finish created, starting tomorrow) hit the
-- guard and returned zero events — the button looked dead
-- (spec/ux-principles.md principle 2). Now it skips the iteration.
--
-- Two coupled changes:
--   1. iterations.skipped — a skipped iteration finalizes with its usual
--      (normally 0) velocity but is EXCLUDED from the velocity window so a
--      0 doesn't drag the running average (spec/velocity.md).
--   2. finalize_iteration gains p_iteration_id. Manual finish is now
--      target-explicit: it finishes exactly the named row iff that row is
--      still the project's latest and not already done. This replaces the
--      start_date <= today double-click guard — a raced/double second call
--      names the now-finished predecessor, sees a newer latest row, and
--      returns a 'noop' event instead of cascading into skipping the fresh
--      successor (which would be a runaway iteration creation).
-- ============================================================

alter table public.iterations
  add column skipped boolean not null default false;

-- Signature changes (adds p_iteration_id), so the old 2-arg function must
-- be dropped, not replaced — CREATE OR REPLACE cannot change the argument
-- list. The new function re-inherits EXECUTE for `authenticated` from the
-- schema's default privileges (20260630000002_grants.sql).
drop function if exists public.finalize_iteration(uuid, boolean);

create function public.finalize_iteration(
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
    -- project_role() returns SQL NULL (not false) for a caller with zero
    -- project_members row — a true outsider, not a viewer. `NULL not in
    -- (...)` is NULL, which `if` treats as false and silently skips the
    -- exception, letting any authenticated user force-finish any project's
    -- iteration (rls-security-reviewer, 2026-07-09). coalesce to a value
    -- that's never a real role so the check still fails closed.
    if coalesce(public.project_role(p_project_id), '') not in ('owner', 'member') then
      raise exception 'Only project owners or members can finish an iteration';
    end if;
    -- Manual finish is target-explicit (see header): the id is the
    -- double-click guard, so a manual call without one fails closed rather
    -- than falling back to the ambiguous "latest non-done" semantics that
    -- could skip a fresh successor.
    if p_iteration_id is null then
      raise exception 'Manual finish requires an iteration id';
    end if;
  else
    if not public.is_project_member(p_project_id) then
      raise exception 'Not a member of this project';
    end if;
  end if;

  -- Serializes every finalize_iteration call (manual or lazy) for this
  -- project, and also serializes against iteration_goals writes (see
  -- check_iteration_goal_number below, same lock key) — closes the known
  -- unlocked-read race documented in 20260708000002_iteration_goals.sql.
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
    -- Nothing to finish — a project with no iterations at all.
    return v_events || jsonb_build_object('kind', 'noop', 'reason', 'nothing_to_finish');
  end if;

  if p_manual and (v_latest.id <> p_iteration_id or v_latest.state = 'done') then
    -- The named iteration is no longer the project's open latest: either a
    -- concurrent finish already advanced past it (a newer row is latest) or
    -- it is already done (a double-click). Report the no-op instead of
    -- cascading into skipping/finishing the successor.
    return v_events || jsonb_build_object('kind', 'noop', 'reason', 'already_finished');
  end if;

  loop
    -- Reset each pass; only the manual skip branch below sets it true, and
    -- manual finish never runs more than one pass.
    v_skip := false;
    if v_latest is null then
      -- Fresh project: iteration #1 starts today.
      v_next_number := 1;
      v_next_start := v_today;
      v_next_end := v_today + (v_iteration_length - 1);
    elsif v_first and p_manual and v_latest.state <> 'done' then
      -- Manual finish of the current iteration, then fall through to
      -- finalize+advance below.
      if v_latest.start_date <= v_today then
        -- Already started: truncate end_date to today so history reflects
        -- the actual duration; the successor starts tomorrow.
        update public.iterations
          set end_date = least(end_date, v_today)
          where id = v_latest.id and state <> 'done';
        v_latest.end_date := least(v_latest.end_date, v_today);
      else
        -- Not yet started: SKIP it. Keep start_date, collapse end_date onto
        -- start_date (zero-length — end_date must never precede start_date),
        -- and flag skipped so the velocity window excludes its (normally 0)
        -- velocity. The successor starts the day after start_date with a
        -- full iteration_length.
        update public.iterations
          set end_date = start_date, skipped = true
          where id = v_latest.id and state <> 'done';
        v_latest.end_date := v_latest.start_date;
        v_skip := true;
      end if;
    elsif v_latest.state <> 'done' and v_latest.end_date >= v_today then
      -- Current row still covers today (or starts in the future, e.g. the
      -- row just created by a manual finish above) — nothing to do. Not
      -- the old TS loop's start_date <= today <= end_date window: a
      -- manually-finished iteration's successor starts tomorrow and would
      -- never satisfy that stricter check, which looped forever.
      exit;
    end if;

    if v_latest is not null then
      -- v_latest.state is always <> 'done' here: either it's the project's
      -- still-open row (loop just fell through the manual-finish or
      -- overdue-rollover branch above), or it's the row this same pass
      -- inserted last iteration (fresh INSERTs default to 'planned') —
      -- never a row already finalized on an earlier pass.
      select coalesce(sum(points), 0) into v_velocity
        from public.stories
        where iteration_id = v_latest.id
          and state = 'accepted'
          and story_type in ('feature', 'bug');

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
      update public.stories
        set iteration_id = v_next_id
        where iteration_id = v_latest.id and state <> 'accepted';
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
-- drop function public.finalize_iteration(uuid, boolean, uuid);
-- (then re-create the 2-arg version from 20260709000002_finalize_iteration.sql)
-- alter table public.iterations drop column skipped;
