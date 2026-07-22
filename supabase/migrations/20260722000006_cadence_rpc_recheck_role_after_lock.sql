-- ============================================================
-- TASK-116 (doc-13 finding #8): re-check the caller's project role AFTER
-- acquiring the advisory lock in the two cadence RPCs.
--
-- override_iteration_length (20260720000006) and reshape_current_iteration
-- (20260721000005) checked the caller's role, then took
-- pg_advisory_xact_lock('iteration_finalize:<project>'), then re-read the
-- iteration row under the lock — but never re-checked the role. A caller
-- can block for an unbounded time waiting for that lock (a rollover /
-- override / reshape holds it), during which their membership may be
-- revoked. On finally acquiring the lock they would still mutate.
--
-- set_story_state / transition_story close the same window differently:
-- being SECURITY INVOKER, RLS re-evaluates the stories UPDATE policy on the
-- final UPDATE (per-statement snapshot) and a de-membered caller filters to
-- 0 rows. These two RPCs are SECURITY DEFINER, so RLS does not apply inside
-- them — the equivalent is an explicit project_role() re-check right after
-- the lock, which is what this migration adds. project_role() reads a fresh
-- per-statement snapshot, so a revocation committed while the caller was
-- blocked is now seen.
--
-- Only the added re-check block differs; the rest of both bodies is
-- reproduced verbatim from their prior migrations (create or replace needs
-- the whole definition).
-- ============================================================

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

  perform public.require_project_role(v_project_id, 'owner', 'member');

  perform pg_advisory_xact_lock(hashtext('iteration_finalize:' || v_project_id::text));

  -- Re-check authorization under the lock (TASK-116): the caller may have
  -- been de-membered while blocked waiting for it. SECURITY DEFINER can't
  -- lean on the RLS re-evaluation set_story_state's final UPDATE uses, so
  -- the membership gate is re-asserted explicitly here.
  perform public.require_project_role(v_project_id, 'owner', 'member');

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

create or replace function public.reshape_current_iteration(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_length int;
  v_today date := (now() at time zone 'utc')::date;
  v_id uuid;
  v_number int;
  v_start_date date;
  v_old_end_date date;
  v_state text;
  v_new_end date;
begin
  perform public.require_project_role(p_project_id, 'owner', 'member');

  select iteration_length into v_length from public.projects where id = p_project_id;
  if v_length is null then
    raise exception 'Project not found';
  end if;

  perform pg_advisory_xact_lock(hashtext('iteration_finalize:' || p_project_id::text));

  -- Re-check authorization under the lock (TASK-116): the caller may have
  -- been de-membered while blocked waiting for it. Same reasoning as
  -- override_iteration_length above.
  perform public.require_project_role(p_project_id, 'owner', 'member');

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

  return jsonb_build_object(
    'kind', 'reshaped', 'number', v_number, 'project_id', p_project_id, 'end_date', v_new_end
  );
end;
$$;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- (restore override_iteration_length from 20260720000006_flexible_cadence.sql
--  and reshape_current_iteration from 20260721000005_reshape_current_iteration.sql
--  — i.e. the same bodies without the post-lock re-check block)
