-- ============================================================
-- TASK-58: index activity_logs.story_id (doc-3 review add-on).
--
-- activity_logs references stories twice on the referencing side — the original
-- story_id -> stories(id) ON DELETE SET NULL FK (20260627000006) and the
-- composite (story_id, project_id) -> stories(id, project_id) FK
-- (20260715000006) — but only project_id was indexed. Every story DELETE (incl.
-- promote_story_to_epic, which deletes the source story) makes Postgres scan
-- activity_logs to enforce/SET NULL both FKs; with no story_id index that is a
-- full scan that grows with activity volume. A single story_id index serves the
-- SET NULL FK and the composite FK's story_id-leading lookup.
-- ============================================================

create index activity_logs_story_id_idx on public.activity_logs (story_id);

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop index public.activity_logs_story_id_idx;
