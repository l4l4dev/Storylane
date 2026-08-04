-- ============================================================
-- Two reads of activity_logs grew past what activity_logs_project_id_idx can
-- serve, and both scale with the project's whole history rather than with the
-- rows they return.
--
-- ponytail: plain CREATE INDEX, not CONCURRENTLY. It takes a ShareLock on
-- activity_logs for the length of the build, and log_story_activity inserts here
-- on every story write, so the build blocks story writes in every project (reads
-- are unaffected — ShareLock, not ACCESS EXCLUSIVE). Acceptable only while the
-- table is small. CONCURRENTLY is the upgrade, but it cannot run inside a
-- transaction block: `supabase migration up` accepts it locally, while the
-- production path (`supabase db push`) and CI's (`supabase start`) are unverified,
-- so switching needs one apply against a throwaway database first. Revisit when
-- the table is large enough for the build to outlast a request.
-- ============================================================

-- 1. The project feed (apps/web/app/projects/[id]/activity/page.tsx).
--
-- It asks for 21 rows ordered by (created_at desc, id desc) with both collapse
-- keys null. With only project_id indexed that is a heap scan of the project's
-- entire history plus a sort, and the excluded rows are fetched before being
-- discarded — a member removal permanently adds N rows that every later page
-- load reads and throws away.
--
-- The predicate matches the reader's two filters verbatim so the planner can use
-- the index for that query; the sort columns are in index order so the LIMIT
-- stops the scan after one page.
create index activity_logs_feed_idx
  on public.activity_logs (project_id, created_at desc, id desc)
  where payload->>'bookkeeping' is null
    and payload->>'feed_collapsed' is null;

-- 2. remove_member's count of the rows its cascade just wrote
-- (20260804073330). It counts by the token, which lives in the payload, so
-- without this index the count is a full heap scan of the project's history —
-- taken while holding pg_advisory_xact_lock('membership:<project>'), so every
-- concurrent membership operation waits behind it and a long-lived project
-- eventually cannot remove a member at all.
--
-- Partial on the key being present: only a cascade's rows ever carry it, which
-- keeps this index a small fraction of the table. `= <token>` implies that
-- predicate (the operator is strict), so the count query matches it.
create index activity_logs_feed_collapsed_idx
  on public.activity_logs ((payload->>'feed_collapsed'))
  where payload->>'feed_collapsed' is not null;

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
--   drop index public.activity_logs_feed_collapsed_idx;
--   drop index public.activity_logs_feed_idx;
-- ============================================================
