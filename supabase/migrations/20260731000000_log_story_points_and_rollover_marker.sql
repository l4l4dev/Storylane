-- ============================================================
-- TASK-218: give the burndown read path the three pieces of history it needs
-- to reconstruct a point-in-time chart instead of projecting today's values
-- backwards over a finished sprint.
--
-- 1. story.points_changed — points were never logged anywhere, so
--    buildBurndown had to apply a story's CURRENT points to every day of
--    every chart. Re-estimating a story silently rewrote already-finalized
--    history. Watched on the trigger like state_id and iteration_id already
--    are, rather than recorded per call site: decision-1 keeps business-rule
--    history in Postgres precisely so iOS and the MCP bot get it too, and a
--    server action would only cover the web app.
--
--    Deliberately NOT filtered by story_type. Only feature/bug carry points
--    today, but a filter here would silently lose history the day that set
--    changes; the readers already filter (storyTypeUsesPoints).
--
-- 2. from_has_state / to_has_state on story.iteration_changed — iteration_id
--    NULL alone cannot tell the Backlog (has a state_id) from the Icebox (no
--    state_id), so the activity feed called both "the Icebox". Recorded as
--    booleans at transition time so the reader needs no second query.
--
-- 3. A `rollover` marker on story.iteration_changed: 'auto', 'manual', or
--    absent. finalize_iteration's reparent is a plain UPDATE caught by this
--    same trigger, so it is indistinguishable from a manual Backlog<->Current
--    drag. A transaction-local GUC set by finalize_iteration is the only
--    signal available: the trigger cannot see its caller, and adding an
--    explicit INSERT back into finalize_iteration is what 20260727140000
--    removed (it misses every other write path).
--
--    Three states, not a boolean, because the two readers need different
--    cuts. The burndown treats 'auto' and 'manual' alike — both are the
--    sprint's closing bookkeeping rather than a membership change inside it.
--    The activity feed must not: a lazy 'auto' rollover is attributed to
--    whichever member's page load happened to trigger it and has no real
--    actor, while 'manual' is someone deliberately clicking Finish.
--
--    First use of set_config/current_setting in this schema. The read side
--    keeps the value as text and never casts: a custom GUC set with
--    is_local => true does NOT go back to unset when the transaction ends —
--    it reverts to the EMPTY STRING. A ''::boolean cast would raise, and
--    would poison every pooled connection that had ever run
--    finalize_iteration, turning every later stories.iteration_id write on it
--    into a 500. nullif(..., '') is what turns that empty string back into a
--    JSON null; missing_ok => true covers the first read on a connection,
--    where the GUC genuinely does not exist yet.
-- ============================================================

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
  v_old_iteration_number int;
  v_new_iteration_number int;
begin
  if tg_op = 'INSERT' then
    insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
    values (
      new.project_id, new.id, coalesce(auth.uid(), new.created_by),
      'story.created', jsonb_build_object('title', new.title)
    );
    return new;
  end if;

  if tg_op = 'UPDATE' and new.state_id is distinct from old.state_id then
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

  if tg_op = 'UPDATE' and new.iteration_id is distinct from old.iteration_id then
    if old.iteration_id is not null then
      select number into v_old_iteration_number from public.iterations where id = old.iteration_id;
    end if;
    if new.iteration_id is not null then
      select number into v_new_iteration_number from public.iterations where id = new.iteration_id;
    end if;
    insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
    values (
      new.project_id, new.id, coalesce(auth.uid(), new.created_by),
      'story.iteration_changed',
      jsonb_build_object(
        'from_iteration_id', old.iteration_id, 'to_iteration_id', new.iteration_id,
        'from_iteration_number', v_old_iteration_number, 'to_iteration_number', v_new_iteration_number,
        'from_has_state', old.state_id is not null, 'to_has_state', new.state_id is not null,
        'rollover', nullif(current_setting('storylane.rollover', true), '')
      )
    );
  end if;

  if tg_op = 'UPDATE' and new.points is distinct from old.points then
    insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
    values (
      new.project_id, new.id, coalesce(auth.uid(), new.created_by),
      'story.points_changed',
      jsonb_build_object('from', old.points, 'to', new.points)
    );
  end if;

  return new;
end;
$$;

-- finalize_iteration: verbatim from 20260728120000 except for the two
-- set_config calls wrapping the loop.
create or replace function public.finalize_iteration(p_project_id uuid, p_manual boolean, p_iteration_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Marks every stories UPDATE below as a rollover for log_story_activity
  -- (TASK-218). Wrapped around the whole loop rather than each reparent: a
  -- neglected project catches up through several iterations in one call, and
  -- a per-UPDATE set/reset pair is one edit away from leaving a later pass
  -- unmarked. is_local = true, so it also dies with the transaction.
  perform set_config('storylane.rollover', case when p_manual then 'manual' else 'auto' end, true);

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
      -- log_story_activity's iteration_id watch (above) now records this
      -- reparent automatically -- no explicit INSERT needed here anymore.
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

  -- Cleared even though is_local = true would drop it at commit: a future
  -- caller composing this RPC with another write in one transaction would
  -- otherwise have that write logged as a rollover too.
  perform set_config('storylane.rollover', '', true);

  -- Exit guard (spec/rls.md "Guard the EXIT of a SECURITY DEFINER RPC"). The
  -- checks above cover the advisory lock, but the writes between them and here
  -- can each wait on a tuple, a foreign key, or a trigger. Only this return is
  -- guarded: the earlier noop returns write nothing, so rejecting them would
  -- turn a harmless no-op into an error.
  perform public.require_project_role(p_project_id, variadic v_roles);

  return v_events;
end;
$function$;

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
--   log_story_activity -> 20260727140000_generalize_iteration_change_log.sql
--   finalize_iteration -> 20260728120000_iteration_rpc_exit_guards.sql
-- Both are full-body replacements; restoring those bodies is the whole
-- rollback. Already-written story.points_changed rows are inert once the
-- readers stop asking for them, so nothing is deleted.
-- ============================================================
