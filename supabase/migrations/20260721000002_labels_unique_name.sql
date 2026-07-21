-- ============================================================
-- TASK-97 (advisor note during TASK-71 review): labels had no
-- UNIQUE(project_id, name), so the MCP bot's resolveLabelIds
-- (apps/mcp/src/handlers.ts) — a select-then-insert name lookup, run once
-- per label per set_story_labels call — could create duplicate same-name
-- labels under concurrency; the previous `.order("id").limit(1)` only
-- picked one of the duplicates once they existed, it never prevented them.
--
-- No backfill: pre-launch, no existing label rows to dedupe (consistent
-- with every other doc-8-era migration in this cycle).
-- ============================================================

alter table public.labels
  add constraint labels_project_id_name_key unique (project_id, name);

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- alter table public.labels drop constraint labels_project_id_name_key;
