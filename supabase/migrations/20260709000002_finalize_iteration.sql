-- ============================================================
-- TASK-10: shared iteration finalization RPC (spec/velocity.md
-- "Finalization concurrency & permissions") and the done-iteration
-- assignment guard trigger it depends on. Advisor-reviewed 2026-07-09.
--
-- Replaces the TS `ensureCurrentIteration` loop in
-- apps/web/app/projects/[id]/board/actions.ts as the single
-- implementation of rollover *and* manual finish (decision-1: this RPC
-- is the deliverable iOS calls too, not a Web-internal helper) —
-- SECURITY DEFINER, per-project advisory lock, idempotent.
-- ============================================================

create or replace function public.finalize_iteration(p_project_id uuid, p_manual boolean)
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
    -- Nothing to finish.
    return v_events;
  end if;

  loop
    if v_latest is null then
      -- Fresh project: iteration #1 starts today.
      v_next_number := 1;
      v_next_start := v_today;
      v_next_end := v_today + (v_iteration_length - 1);
    elsif v_first and p_manual and v_latest.state <> 'done' and v_latest.start_date <= v_today then
      -- Manual finish: close the *started* current iteration early
      -- regardless of its end_date, then fall through to finalize+advance
      -- below. Guarded on start_date <= today so a double-clicked/raced
      -- second manual-finish call — which now sees the fresh successor row
      -- the first call just created, starting tomorrow — falls through to
      -- the exit branch below instead of truncating a not-yet-started
      -- iteration's end_date before its own start_date.
      update public.iterations
        set end_date = least(end_date, v_today)
        where id = v_latest.id and state <> 'done';
      v_latest.end_date := least(v_latest.end_date, v_today);
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
        v_events := v_events || jsonb_build_object('kind', 'finalized', 'number', v_latest.number, 'velocity', v_velocity);
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

-- Closes the race documented in 20260708000002_iteration_goals.sql: a
-- goal write for a virtual number now serializes against any in-flight
-- finalize_iteration call for the same project via the identical lock key,
-- so it can no longer land on a number a concurrent rollover is about to
-- create a real row for.
create or replace function public.check_iteration_goal_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('iteration_finalize:' || new.project_id::text));
  if new.number <= coalesce(
    (select max(number) from public.iterations where project_id = new.project_id), 0
  ) then
    raise exception 'iteration_goals.number must be greater than the current iteration number';
  end if;
  return new;
end;
$$;

-- Rejects pointing a story at a finalized iteration — the authoritative
-- guard against the TOCTOU gap where a drag/autosave lands just after a
-- concurrent finalization (the app's pre-check is UX only). Scoped to only
-- fire when iteration_id actually changes, so ordinary edits to an
-- accepted story still sitting on its now-done iteration (autosave,
-- update_story RPC) are unaffected.
create or replace function public.reject_done_iteration_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_state text;
begin
  if new.iteration_id is null then
    return new;
  end if;

  select state into v_state from public.iterations where id = new.iteration_id;

  if v_state = 'done' then
    raise exception 'Cannot assign a story to a finalized iteration' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger stories_reject_done_iteration_insert
  before insert on public.stories
  for each row
  when (new.iteration_id is not null)
  execute function public.reject_done_iteration_assignment();

create trigger stories_reject_done_iteration_update
  before update on public.stories
  for each row
  when (new.iteration_id is distinct from old.iteration_id)
  execute function public.reject_done_iteration_assignment();

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop trigger stories_reject_done_iteration_update on public.stories;
-- drop trigger stories_reject_done_iteration_insert on public.stories;
-- drop function public.reject_done_iteration_assignment();
-- create or replace function public.check_iteration_goal_number()
-- returns trigger language plpgsql security definer set search_path = public as $$
-- begin
--   if new.number <= coalesce(
--     (select max(number) from public.iterations where project_id = new.project_id), 0
--   ) then
--     raise exception 'iteration_goals.number must be greater than the current iteration number';
--   end if;
--   return new;
-- end;
-- $$;
-- drop function public.finalize_iteration(uuid, boolean);
