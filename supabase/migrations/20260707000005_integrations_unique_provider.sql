-- ============================================================
-- Task 12: one integration per provider per project — the settings UI
-- upserts on (project_id, provider), and the git-webhook Edge Function
-- resolves the signing secret by that same pair, so duplicates would make
-- both ambiguous.
-- ============================================================

alter table public.integrations
  add constraint integrations_project_id_provider_key unique (project_id, provider);

-- DOWN (rollback):
-- alter table public.integrations drop constraint integrations_project_id_provider_key;
