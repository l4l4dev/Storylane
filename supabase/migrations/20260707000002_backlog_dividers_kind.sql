-- ============================================================
-- backlog_dividers.kind — distinguishes a freeform planning note from a
-- manually-placed iteration break (Task 15 follow-up, 2026-07-07: Mika
-- wants to force a velocity-group boundary at a chosen spot, not just rely
-- on the automatic capacity-based split — see spec/velocity.md "Marker
-- computation" and lib/utils/iterations.ts "buildBacklogRows").
--
-- 'note': cosmetic only, no effect on iteration numbering (existing behavior).
-- 'iteration_break': forces the current virtual iteration to close at this
--   exact point, regardless of remaining velocity capacity; the next story
--   after it always starts a fresh (numbered) virtual iteration.
-- ============================================================

alter table public.backlog_dividers
  add column kind text not null default 'note' check (kind in ('note', 'iteration_break'));

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- alter table public.backlog_dividers drop column kind;
