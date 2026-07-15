---
id: TASK-63
title: Redact integrations.webhook_secret from client reads (set/rotate only)
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-15 04:54'
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
- [ ] #1 webhook_secret is never returned to any authenticated client query after creation
- [ ] #2 Owner can set and rotate the secret from settings; blank-on-edit keeps the existing secret
- [ ] #3 git-webhook Edge Function still verifies signatures (reads the secret via service role)
- [ ] #4 rls-security-reviewer passes
<!-- AC:END -->
