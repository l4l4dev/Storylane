---
id: TASK-63
title: Redact integrations.webhook_secret from client reads (set/rotate only)
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-15 04:54'
updated_date: '2026-07-15 06:10'
labels:
  - security
  - rls
  - db
  - web
dependencies: []
priority: high
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Split from TASK-55 (sub-area 3). Codex (doc-1): integrations.config.webhook_secret is returned to the owner's browser via the owner SELECT policy + prefilled in the settings form (integration-settings.tsx defaultValue). Move the secret out of config jsonb into a dedicated integrations.webhook_secret column (one-time migration copies existing + strips from config); make it non-readable by authenticated (column-level: revoke table SELECT, re-grant SELECT on every column EXCEPT webhook_secret; service_role keeps it). saveIntegration writes the column (blank on update = keep existing, so no read-back needed; required on create). git-webhook Edge Function reads the column instead of config.webhook_secret. Settings UI shows a set/rotate field (never displays the current secret). Verify with an integration test that authenticated cannot select webhook_secret and the Edge Function (service role) can. rls-security-reviewer on the migration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 webhook_secret is never returned to any authenticated client query after creation
- [x] #2 Owner can set and rotate the secret from settings; blank-on-edit keeps the existing secret
- [x] #3 git-webhook Edge Function still verifies signatures (reads the secret via service role)
- [x] #4 rls-security-reviewer passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Migration 20260715000007_redact_webhook_secret.sql:
   - add integrations.webhook_secret text (nullable)
   - one-time: copy config->>'webhook_secret' into column, strip key from config jsonb
   - revoke SELECT on integrations from authenticated; re-grant SELECT on every column EXCEPT webhook_secret (INSERT/UPDATE/DELETE untouched → owner can still write it). service_role keeps table-level grant (reads it).
2. saveIntegration (settings/actions.ts): write webhook_secret to the column, not config. Look up existing row (select id); blank-on-update keeps existing (omit column from upsert payload → PostgREST leaves it); blank-on-create → 'required' error. Never read the secret back.
3. integration-settings.tsx: drop config.webhook_secret from IntegrationRow type + defaultValue prefill; field is set/rotate only (placeholder 'leave blank to keep existing'); required only when creating.
4. git-webhook/index.ts: select 'webhook_secret, is_active'; read integration.webhook_secret. Update index.test.ts fake to return the column.
5. New integration test webhook-secret-redaction.integration.test.ts: owner upsert of secret succeeds (proves no RETURNING trap); authenticated .select('webhook_secret') errors; service_role reads the secret; owner can still select non-secret columns.
6. rls-security-reviewer on the migration (AC #4).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented (2026-07-15):
- Migration 20260715000007_redact_webhook_secret.sql: new integrations.webhook_secret column, backfill from config + strip key, column-level SELECT for authenticated excluding webhook_secret (INSERT/UPDATE untouched). service_role keeps table-level SELECT.
- saveIntegration: github/forgejo now use plain insert (create) / update (edit), NOT upsert. Reason: an upsert carrying webhook_secret makes PostgREST return a representation it can't SELECT → 42501; plain insert/update run return=minimal. Blank secret on edit omits the column → stored value preserved (set/rotate). Slack path unchanged (upsert, no secret column).
- integration-settings.tsx: dropped webhook_secret from IntegrationRow/config type and defaultValue prefill; field is type=password, required only on create, placeholder says blank keeps existing.
- git-webhook/index.ts: selects webhook_secret column (not config); test fake updated.
- New apps/web/lib/utils/webhook-secret-redaction.integration.test.ts (5 assertions): owner write on create, owner reads non-secret cols, authenticated CANNOT select webhook_secret (42501), service_role CAN, blank-edit keeps secret.
- Regenerated apps/web/lib/database.types.ts.
Verification: tsc clean, lint clean, full suite 491 passed (SUPABASE_INTEGRATION=1), deno git-webhook 6 passed. rls-security-reviewer: no issues (ran supabase db reset + live privilege queries + integration test 5/5).
<!-- SECTION:NOTES:END -->
