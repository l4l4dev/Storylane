-- ============================================================
-- TASK-16.2: Free mode WIP limits (spec/screens.md "Free mode board" —
-- KanbanFlow parity additions, spec/data-model.md custom_statuses).
-- Soft limit only — nothing here blocks a drop; enforcement is purely a
-- warning-colored header count in the UI (dropStoryFree, unlike a tracker
-- transition, never validates against any per-column capacity).
-- ============================================================

alter table public.custom_statuses add column wip_limit int check (wip_limit > 0);

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- alter table public.custom_statuses drop column wip_limit;
