-- ============================================================
-- TASK-142 (found during TASK-116): finalize_iteration has the same TOCTOU
-- hole the cadence RPCs had. doc-13's claim that it "re-derives authorization
-- after the lock" is wrong — the role is checked BEFORE
-- pg_advisory_xact_lock('iteration_finalize:<project>'), and a caller can
-- block on that lock for an unbounded time (a concurrent rollover / override /
-- reshape holds it). If their membership is revoked while they wait, they
-- still finalize on acquiring it.
--
-- Fix is TASK-116's exactly: re-assert the membership gate immediately after
-- the lock. project_role() is STABLE but each PL/pgSQL statement gets its own
-- READ COMMITTED snapshot, so the second call sees a revocation committed
-- while the caller was blocked. SECURITY DEFINER means RLS never applies
-- inside this function, so an explicit re-check is the only equivalent of the
-- RLS re-evaluation set_story_state's final UPDATE gets for free.
--
-- Also converts both pre-lock guards from the inline dialects to
-- require_project_role, per spec/rls.md "RPC role guards" (existing RPCs are
-- converted as each is next touched). BEHAVIOR NOTE: the helper raises
-- 'not authorized' (42501), so the two descriptive messages this function used
-- to raise ('Only project owners or members can finish an iteration' /
-- 'Not a member of this project') are gone — that is the documented,
-- intentional trade of the helper convention.
--
-- The role sets are preserved exactly, and deliberately differ:
--   * manual finish  — owner/member (an explicit user action)
--   * lazy rollover  — owner/member/VIEWER, because the old guard was
--     is_project_member(), which is true for ANY role. A viewer opening the
--     board must still trigger the rollover; gating it to writers would leave
--     them staring at a stale iteration forever.
-- They are hoisted into v_roles so the pre- and post-lock checks can never
-- drift apart — a drift would silently re-open this same hole.
--
-- Everything below the guards is reproduced verbatim from
-- 20260720000006_flexible_cadence.sql (create or replace needs the whole
-- definition); finalize_iteration is the shared lazy-rollover/manual-finish
-- path, so nothing else may change.
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
  -- Manual finish is a writer action; lazy rollover runs for any member,
  -- viewers included (see the header). One list, used for both the pre- and
  -- post-lock assertion.
  v_roles text[] := case when p_manual then array['owner', 'member'] else array['owner', 'member', 'viewer'] end;
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
-- (restore finalize_iteration from 20260720000006_flexible_cadence.sql — i.e.
--  the same body with the inline pre-lock guards and no post-lock re-check)
