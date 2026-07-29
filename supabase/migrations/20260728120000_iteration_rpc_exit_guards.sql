-- ============================================================
-- TASK-211: exit guards for the three iteration RPCs.
--
-- These re-assert the role after `iteration_finalize:` and then keep writing, so
-- the advisory lock is not the last point they can block: the writes that follow
-- can each wait on a tuple lock, a foreign key, or a trigger. Guarding the exit
-- covers all of it — nothing is durable until commit, so raising after the last
-- write rolls the whole operation back (spec/rls.md "Guard the EXIT of a
-- SECURITY DEFINER RPC").
--
-- Only the write-bearing return is guarded in each. The earlier noop/unchanged
-- returns write nothing, so rejecting them would turn a harmless no-op into a
-- 42501 for a caller whose access lapsed mid-call — a behaviour change rather
-- than a closed hole.
--
-- override_iteration_length and reshape_current_iteration also move their role
-- list into a variable, so their now-three assertions cannot drift apart.
-- ============================================================

-- ── finalize_iteration ───────────────────────
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


  -- Exit guard (spec/rls.md "Guard the EXIT of a SECURITY DEFINER RPC"). The
  -- checks above cover the advisory lock, but the writes between them and here
  -- can each wait on a tuple, a foreign key, or a trigger. Only this return is
  -- guarded: the earlier noop returns write nothing, so rejecting them would
  -- turn a harmless no-op into an error.
  perform public.require_project_role(p_project_id, variadic v_roles);

  return v_events;
end;
$function$;

-- ── override_iteration_length ───────────────────────
create or replace function public.override_iteration_length(p_iteration_id uuid, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- One list for every assertion in this function, so they cannot drift.
  v_roles text[] := array['owner', 'member'];
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

  perform public.require_project_role(v_project_id, variadic v_roles);

  perform pg_advisory_xact_lock(hashtext('iteration_finalize:' || v_project_id::text));

  -- Re-check authorization under the lock (TASK-116): the caller may have
  -- been de-membered while blocked waiting for it. SECURITY DEFINER can't
  -- lean on the RLS re-evaluation set_story_state's final UPDATE uses, so
  -- the membership gate is re-asserted explicitly here.
  perform public.require_project_role(v_project_id, variadic v_roles);

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


  -- Exit guard (spec/rls.md "Guard the EXIT of a SECURITY DEFINER RPC"). The
  -- checks above cover the advisory lock, but the writes between them and here
  -- can each wait on a tuple, a foreign key, or a trigger. Only this return is
  -- guarded: the earlier noop returns write nothing, so rejecting them would
  -- turn a harmless no-op into an error.
  perform public.require_project_role(v_project_id, variadic v_roles);

  return jsonb_build_object(
    'kind', 'overridden', 'number', v_number,
    'project_id', v_project_id, 'end_date', p_end_date
  );
end;
$function$;

-- ── reshape_current_iteration ───────────────────────
create or replace function public.reshape_current_iteration(p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- One list for every assertion in this function, so they cannot drift.
  v_roles text[] := array['owner', 'member'];
  v_length int;
  v_today date := (now() at time zone 'utc')::date;
  v_id uuid;
  v_number int;
  v_start_date date;
  v_old_end_date date;
  v_state text;
  v_new_end date;
begin
  perform public.require_project_role(p_project_id, variadic v_roles);

  select iteration_length into v_length from public.projects where id = p_project_id;
  if v_length is null then
    raise exception 'Project not found';
  end if;

  perform pg_advisory_xact_lock(hashtext('iteration_finalize:' || p_project_id::text));

  -- Re-check authorization under the lock (TASK-116): the caller may have
  -- been de-membered while blocked waiting for it. Same reasoning as
  -- override_iteration_length above.
  perform public.require_project_role(p_project_id, variadic v_roles);

  -- The current iteration is the latest non-... whichever row a rollover last
  -- left in place; re-read under the lock (a rollover racing this call may
  -- have finished it and started its successor).
  select id, number, start_date, end_date, state
    into v_id, v_number, v_start_date, v_old_end_date, v_state
    from public.iterations
    where project_id = p_project_id
    order by number desc
    limit 1;

  -- No current iteration yet (a brand-new project reached via a Settings
  -- deep-link before /board ran ensureCurrentIteration): nothing to reshape,
  -- and the new length already applies to the first iteration when it's
  -- created. A benign no-op, not an error — and it keeps the NULL start_date
  -- out of the arithmetic below.
  if v_id is null then
    return jsonb_build_object('kind', 'noop', 'reason', 'no_current_iteration', 'project_id', p_project_id);
  end if;
  if v_state = 'done' then
    return jsonb_build_object('kind', 'noop', 'reason', 'already_finished', 'project_id', p_project_id);
  end if;

  -- Re-derive the end date from the (already-updated) project length, exactly
  -- as finalize_iteration would for a fresh row starting on this start_date.
  if v_length = 1 then
    v_new_end := coalesce(public.next_working_day(p_project_id, v_start_date + 1), v_start_date + 1) - 1;
  else
    v_new_end := v_start_date + (v_length - 1);
  end if;

  -- Shrinking a running sprint so its new end lands before today (or before
  -- its own start) isn't a reshape — that's a "finish early", which has its
  -- own confirmed action. Leave the current iteration untouched (the length
  -- change still took effect for the next one); report why rather than raise,
  -- so the caller's plain settings save never 500s.
  if v_new_end < greatest(v_start_date, v_today) then
    return jsonb_build_object('kind', 'noop', 'reason', 'would_end_in_past', 'project_id', p_project_id);
  end if;
  if v_new_end > v_start_date + 89 then
    return jsonb_build_object('kind', 'noop', 'reason', 'too_long', 'project_id', p_project_id);
  end if;
  if v_new_end = v_old_end_date then
    return jsonb_build_object('kind', 'unchanged', 'number', v_number, 'project_id', p_project_id);
  end if;

  update public.iterations set end_date = v_new_end where id = v_id;

  -- Recorded like override: this moves a live sprint boundary. auth.uid()
  -- unqualified — the project_role() gate above can't pass for a null uid.
  insert into public.activity_logs (project_id, actor_id, action, payload)
  values (
    p_project_id, auth.uid(), 'iteration.reshaped',
    jsonb_build_object('number', v_number, 'from', v_old_end_date, 'to', v_new_end, 'length', v_length)
  );


  -- Exit guard (spec/rls.md "Guard the EXIT of a SECURITY DEFINER RPC"). The
  -- checks above cover the advisory lock, but the writes between them and here
  -- can each wait on a tuple, a foreign key, or a trigger. Only this return is
  -- guarded: the earlier noop returns write nothing, so rejecting them would
  -- turn a harmless no-op into an error.
  perform public.require_project_role(p_project_id, variadic v_roles);

  return jsonb_build_object(
    'kind', 'reshaped', 'number', v_number, 'project_id', p_project_id, 'end_date', v_new_end
  );
end;
$function$;

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
--   finalize_iteration        -> 20260727140000_generalize_iteration_change_log.sql
--   override_iteration_length -> 20260722000006_cadence_rpc_recheck_role_after_lock.sql
--   reshape_current_iteration -> 20260722000006_cadence_rpc_recheck_role_after_lock.sql
-- ============================================================
