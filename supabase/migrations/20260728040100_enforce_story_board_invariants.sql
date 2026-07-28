-- ============================================================
-- TASK-208: enforce the board's two write-path-independent invariants in the
-- DB instead of only inside set_story_state.
--
-- stories UPDATE RLS (20260719000002) lets any project member write any column,
-- so a direct PostgREST `.update()` reached a done-category state on an
-- unestimated feature and left an in_progress story with no iteration. Both were
-- reproduced against a live DB before this migration; the first also stamped
-- completed_at via maintain_story_completed_at, making the row count toward
-- velocity. decision-1 principle 2: invariants live in the DB, so the rules move
-- to a trigger every write path inherits rather than gaining a third copy per
-- caller.
--
-- The two gates key off DIFFERENT changes, which is what keeps rollover working:
--
--   * The estimation gate fires when any of ITS OWN INPUTS move — the category,
--     points, or story_type. Gating on the category alone let the forbidden end
--     state be reached in two writes, with the second write disguised as
--     something else: estimate then clear the estimate, or set a done chore's
--     type to 'feature'. Both left an unestimated feature resting in a finished
--     state with completed_at still stamped, which is the velocity-counting
--     shape this migration exists to prevent.
--
--     Crucially it does NOT fire on a write that changes none of those, which is
--     what keeps finalize_iteration's rollover working: that UPDATE touches only
--     iteration_id, so a pre-existing row at "in_progress with points NULL"
--     (reachable before this migration) still rolls over instead of failing the
--     whole finalize RPC for the project.
--
--     Consequence worth knowing: clearing an estimate outright on a started or
--     finished feature is now rejected, where before it silently produced that
--     shape. Changing an estimate to a different value is unaffected.
--
--   * The iteration gate fires when the category moves OR the iteration changes,
--     so it also catches a direct update that clears iteration_id while leaving
--     an in_progress story in place. Rollover always writes a non-NULL
--     iteration_id, so it passes.
--
-- Reject-only, by design: entering an in_progress category REQUIRES an
-- iteration_id, and the sanctioned RPCs keep resolving and assigning it
-- themselves. Auto-assigning here would mean taking pg_advisory_xact_lock and
-- duplicating the current-iteration resolution inside a row trigger, for callers
-- that already do both.
--
-- Writes no NEW field, so it has no firing-order dependency: none of the eight
-- other BEFORE triggers on stories writes state_id or iteration_id. TASK-195's
-- trigger-order hardening is therefore not a prerequisite, and this adds no new
-- ordering to harden.
--
-- SECURITY DEFINER (like maintain_story_completed_at): the category lookup must
-- not depend on the writer's own visibility of project_states. Under INVOKER an
-- RLS-hidden row would resolve the category to NULL and silently skip both
-- gates — a bypass rather than a denial.
--
-- Container state (AC #2) needs nothing here: stories_container_off_board_check
-- already rejects a non-NULL state_id on a container on every path.
--
-- KNOWN CONSEQUENCE — deleting an iteration row that still has in_progress
-- stories now fails. stories.iteration_id is ON DELETE SET NULL, and the UPDATE
-- the FK issues hits the iteration gate. Nothing deletes iterations today, and
-- project deletion is unaffected (the stories cascade runs first), but a future
-- iteration-delete feature has to clear or move those stories first rather than
-- rely on the FK action. Left as a hard failure on purpose: silently orphaning
-- in_progress work off the board is the thing this gate exists to stop.
--
-- This trigger is forward-only; it does not repair rows the pre-fix bypass
-- already created. To find them:
--
--   select s.id, s.project_id, ps.category, s.points, s.iteration_id
--     from public.stories s
--     left join public.project_states ps on ps.id = s.state_id
--     join public.projects p on p.id = s.project_id and not p.is_personal
--    where not s.is_container
--      and (
--        (ps.category is not null and ps.category <> 'unstarted'
--           and s.story_type = 'feature' and s.points is null)
--        or (ps.category = 'in_progress' and s.iteration_id is null)
--      );
-- ============================================================

create or replace function public.enforce_story_board_invariants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_category text;
  v_new_category text;
  v_is_personal boolean;
  v_category_moved boolean;
  v_iteration_moved boolean;
  v_estimation_input_moved boolean;
begin
  -- The Icebox (state_id NULL) is always reachable and carries no iteration.
  if new.state_id is null then
    return new;
  end if;

  -- Raw column comparison BEFORE any lookup: a write listing one of the watched
  -- columns without actually changing it must not pay for two project_states
  -- queries. move_story_board's anchored moves shift a bounded range of rows, so
  -- resolving categories first turned one reorder into 2N extra SPI queries.
  if tg_op = 'UPDATE' then
    if old.state_id is not distinct from new.state_id
       and old.iteration_id is not distinct from new.iteration_id
       and old.points is not distinct from new.points
       and old.story_type is not distinct from new.story_type then
      return new;
    end if;
  end if;

  select category into v_new_category from public.project_states where id = new.state_id;

  if tg_op = 'UPDATE' then
    if old.state_id is not null then
      select category into v_old_category from public.project_states where id = old.state_id;
    end if;
    v_category_moved := v_old_category is distinct from v_new_category;
    v_iteration_moved := old.iteration_id is distinct from new.iteration_id;
    -- points and story_type are the gate's other two inputs; a write that moves
    -- either can reach the forbidden shape without touching the category.
    v_estimation_input_moved := v_category_moved
                                or new.points is distinct from old.points
                                or new.story_type is distinct from old.story_type;
  else
    v_category_moved := true;
    v_iteration_moved := true;
    v_estimation_input_moved := true;
  end if;

  -- Two states sharing one category is not a move this trigger governs.
  if not v_estimation_input_moved and not v_iteration_moved then
    return new;
  end if;

  -- Personal projects have neither estimation nor iterations (doc-15);
  -- set_story_state exempts them from both gates, so match it exactly.
  select is_personal into v_is_personal from public.projects where id = new.project_id;
  if coalesce(v_is_personal, false) then
    return new;
  end if;

  if v_estimation_input_moved
     and v_new_category <> 'unstarted'
     and new.story_type = 'feature' and new.points is null then
    raise exception 'An unestimated feature can only be in the Icebox or an unstarted state'
      using errcode = 'P0001';
  end if;

  if v_new_category = 'in_progress' and new.iteration_id is null then
    raise exception 'No active iteration' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- CREATE FUNCTION hands EXECUTE to public by default, which would leave a
-- SECURITY DEFINER function reachable by anon. Same lockdown every other
-- trigger function here carries (20260715000005).
revoke execute on function public.enforce_story_board_invariants() from public, anon, authenticated;

-- Scoped to the four columns the gates read, so a position-only write from
-- move_story_board's reorder path does not dispatch this trigger at all. UPDATE
-- OF fires on a column being listed in SET, not on its value changing, so the
-- function still re-checks the values itself before doing any lookup.
--
-- No ordering prefix in the name: this trigger reads NEW and raises, so its
-- position among the other BEFORE triggers cannot change its result.
create trigger stories_enforce_board_invariants
  before insert or update of state_id, iteration_id, points, story_type on public.stories
  for each row execute function public.enforce_story_board_invariants();

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop trigger stories_enforce_board_invariants on public.stories;
-- drop function public.enforce_story_board_invariants();
-- ============================================================
