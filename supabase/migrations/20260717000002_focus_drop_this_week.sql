-- ============================================================
-- TASK-34: drop 'this_week' from the Focus view's focus values.
-- Advisor-corrected design (Fable, 2026-07-17) — the 2026-07-11 design note on
-- this task proposed replacing the Focus view's manual `focus` column with a
-- derived view, having rejected "a manual per-story 'today' flag" as too
-- costly. That column already shipped on 2026-07-09
-- (20260709000004_focus_view.sql) and gained more investment on 2026-07-15
-- (move_story_board's focus delta handling) — the design didn't know about it.
-- Corrected scope: keep the shipped `focus` system, just narrow it to
-- Today-only per the user's actual ask ("both modes should focus on TODAY,
-- not the week").
--
-- Owner-approved (2026-07-17): this UPDATE is not scoped to a single primary
-- key, but it only ever narrows `focus` toward NULL — a story that was in the
-- This week column falls back to Todo, same as any story with focus IS NULL.
-- No row is deleted and no other column changes.
-- ============================================================

update public.stories set focus = null where focus = 'this_week';

alter table public.stories drop constraint stories_focus_check;
alter table public.stories add constraint stories_focus_check check (focus in ('today'));

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- alter table public.stories drop constraint stories_focus_check;
-- alter table public.stories add constraint stories_focus_check check (focus in ('today', 'this_week'));
