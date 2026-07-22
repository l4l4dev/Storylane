-- ============================================================
-- TASK-135 (found in code review 2026-07-21): backfill the one-time gap left
-- by TASK-111 (20260721000007_move_story_board_global_positions.sql).
--
-- TASK-111 made move_story_board maintain ONE iteration-wide position sequence
-- going forward, but shipped no backfill. Rows positioned under the old
-- per-(iteration_id, state_id) scheme still carry column-local 0-based runs, so
-- position values OVERLAP across an iteration's state columns. kanban.ts's
-- flattenCurrentZone (List view) sorts purely by `position` with no tiebreak,
-- so such an iteration renders out of order until its first drag re-densifies
-- it as a side effect. This renumbers every pre-existing iteration to the same
-- dense, iteration-wide 0-based sequence move_story_board now produces.
--
-- Ordering: primary key is `position` (exactly what move_story_board densifies
-- by going forward, and what the List/Kanban views read). The bug is the
-- cross-column TIE at equal positions; it is broken by the board's own visual
-- reading order — the state column's left-to-right position
-- (project_states.position) — then by id as a final deterministic tiebreak.
-- An iteration that is already dense/unique by position is a total order under
-- the primary key alone, so the tiebreak never fires and it renumbers to
-- itself (no-op).
--
-- Idempotent: `position is distinct from new_pos` writes only rows that
-- actually move, so a second run (or a run against a DB where some iterations
-- already self-healed via a drag) touches nothing. Backlog stories
-- (iteration_id is null) are a separate, correctly-scoped sequence and are
-- excluded (TASK-135 AC #2).
--
-- A position-only UPDATE fires only set_updated_at among stories' triggers
-- (maintain_story_completed_at early-returns on unchanged state_id;
-- reject_done_iteration_assignment is WHEN iteration_id changes;
-- pin_story_number guards number) — no functional side effect.
-- ============================================================

with ranked as (
  select
    s.id,
    row_number() over (
      partition by s.project_id, s.iteration_id
      order by s.position, coalesce(ps.position, 2147483647), s.id
    ) - 1 as new_pos
  from public.stories s
  left join public.project_states ps on ps.id = s.state_id
  where s.iteration_id is not null
)
update public.stories s
set position = r.new_pos
from ranked r
where s.id = r.id
  and s.position is distinct from r.new_pos;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- None. This is a one-time data normalization onto the sequence
-- move_story_board already maintains; there is no meaningful inverse (the old
-- overlapping per-column values are not recoverable and were the bug).
