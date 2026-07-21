-- ============================================================
-- TASK-105 (doc-11 D3): when the project's iteration_length changes, the
-- owner can opt into re-shaping the CURRENT iteration to the new length
-- immediately (default stays TASK-87's "applies from the next iteration").
--
-- A dedicated RPC rather than an extension of override_iteration_length: that
-- one takes a caller-supplied end_date, whereas here the end_date is DERIVED
-- from the project's (already-updated) iteration_length — and for a 1-day
-- cadence that derivation must use the working-day rule, which only exists
-- DB-side (next_working_day, mirroring finalize_iteration's branch). Reusing
-- the same advisory lock + re-read-under-lock + bounds as override, so a
-- rollover / override / reshape can't interleave into inconsistent boundaries.
--
-- SECURITY DEFINER because TASK-86 revoked table UPDATE on iterations from
-- authenticated (only update(goal) remains) — writing end_date needs the
-- postgres-owned definer, same as override_iteration_length / finalize.
-- ============================================================
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
  if coalesce(public.project_role(p_project_id), '') not in ('owner', 'member') then
    raise exception 'Only project owners or members can reshape an iteration';
  end if;

  select iteration_length into v_length from public.projects where id = p_project_id;
  if v_length is null then
    raise exception 'Project not found';
  end if;

  perform pg_advisory_xact_lock(hashtext('iteration_finalize:' || p_project_id::text));

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

revoke execute on function public.reshape_current_iteration(uuid) from public, anon;
grant execute on function public.reshape_current_iteration(uuid) to authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.reshape_current_iteration(uuid);
