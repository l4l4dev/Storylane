-- ============================================================
-- Task 11 — Realtime Collaboration prerequisite.
-- Enable Postgres Changes for `stories` and `comments` so clients can
-- subscribe to live updates (board panels, story detail comment thread).
-- REPLICA IDENTITY FULL is required so DELETE/UPDATE events carry the old
-- row's project_id / story_id — Realtime evaluates RLS against that data,
-- and the default replica identity (primary key only) wouldn't include it.
-- ============================================================

alter table public.stories replica identity full;
alter table public.comments replica identity full;

alter publication supabase_realtime add table public.stories;
alter publication supabase_realtime add table public.comments;

-- DOWN (rollback):
-- alter publication supabase_realtime drop table public.comments;
-- alter publication supabase_realtime drop table public.stories;
-- alter table public.comments replica identity default;
-- alter table public.stories replica identity default;
