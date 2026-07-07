-- ============================================================
-- Task 15 follow-up: enable Postgres Changes for backlog_dividers so the
-- board's Realtime subscription refreshes when another user adds, moves,
-- or deletes a planning divider — same pattern as stories/comments
-- (20260704000001_realtime_publication.sql). REPLICA IDENTITY FULL is
-- required so DELETE/UPDATE events carry the old row's project_id, which
-- Realtime evaluates RLS against.
-- ============================================================

alter table public.backlog_dividers replica identity full;

alter publication supabase_realtime add table public.backlog_dividers;

-- DOWN (rollback):
-- alter publication supabase_realtime drop table public.backlog_dividers;
-- alter table public.backlog_dividers replica identity default;
