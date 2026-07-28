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
--   * The estimation gate fires when the CATEGORY MOVES, and additionally when
--     POINTS are cleared on a row already resting in a done/rejected category.
--     Gating on category movement alone let the forbidden end state be reached
--     in two writes — estimate, move to done, then clear the estimate — leaving
--     an unestimated feature in done with completed_at still stamped, which is
--     the velocity-counting shape this whole migration exists to prevent.
--     The points condition is deliberately NOT applied to in_progress: a row
--     legitimately rests at "in_progress with points NULL" (set_story_state
--     starts an estimated feature, then update_story clears the estimate with no
--     state-based gate of its own), and finalize_iteration's rollover UPDATE
--     touches only iteration_id. Re-validating that shape would make the
--     rollover raise and fail the whole finalize RPC for the project.
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
  v_estimate_dropped boolean;
begin
  -- The Icebox (state_id NULL) is always reachable and carries no iteration.
  if new.state_id is null then
    return new;
  end if;

  select category into v_new_category from public.project_states where id = new.state_id;

  if tg_op = 'UPDATE' then
    if old.state_id is not null then
      select category into v_old_category from public.project_states where id = old.state_id;
    end if;
    v_category_moved := v_old_category is distinct from v_new_category;
    v_iteration_moved := old.iteration_id is distinct from new.iteration_id;
    -- Clearing the estimate while the story rests in a finished category is the
    -- second half of the two-write route to the state this trigger forbids.
    v_estimate_dropped := new.points is distinct from old.points
                          and v_new_category in ('done', 'rejected');
  else
    v_category_moved := true;
    v_iteration_moved := true;
    v_estimate_dropped := false;
  end if;

  -- Nothing this trigger governs has moved (a rename, a reorder, an estimate
  -- edit outside a finished category, or a move between two states sharing one
  -- category).
  if not v_category_moved and not v_iteration_moved and not v_estimate_dropped then
    return new;
  end if;

  -- Personal projects have neither estimation nor iterations (doc-15);
  -- set_story_state exempts them from both gates, so match it exactly.
  select is_personal into v_is_personal from public.projects where id = new.project_id;
  if coalesce(v_is_personal, false) then
    return new;
  end if;

  if (v_category_moved or v_estimate_dropped)
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

-- No ordering prefix in the name: this trigger reads NEW and raises, so its
-- position among the other BEFORE triggers cannot change its result.
create trigger stories_enforce_board_invariants
  before insert or update on public.stories
  for each row execute function public.enforce_story_board_invariants();

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop trigger stories_enforce_board_invariants on public.stories;
-- drop function public.enforce_story_board_invariants();
-- ============================================================
