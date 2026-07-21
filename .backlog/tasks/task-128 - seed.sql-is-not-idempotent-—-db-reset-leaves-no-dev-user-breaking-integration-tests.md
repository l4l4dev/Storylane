---
id: TASK-128
title: >-
  seed.sql is not idempotent — db reset leaves no dev user, breaking integration
  tests
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 11:18'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 12500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during TASK-110 verification. 'supabase db reset' runs seed.sql, but the vault.create_secret inserts (slack_notify_url / slack_notify_secret) hit 'duplicate key value violates unique constraint secrets_name_idx' because the secrets already exist from an earlier apply/migration, and the seed aborts partway — leaving the dev user (dev@storylane.local) uncreated. Every SUPABASE_INTEGRATION=1 test then fails at dev-user sign-in ('Invalid login credentials'). Workaround this session was to run the auth.users portion of seed.sql manually. Fix: make seed.sql idempotent (guard the vault inserts with an existence check / on-conflict, or delete-before-insert), so a clean 'supabase db reset' always lands the dev user and the vault secrets without aborting.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 supabase db reset (clean) completes seeding without error and creates dev@storylane.local
- [ ] #2 The vault.create_secret calls for slack_notify_url/slack_notify_secret no longer abort on a re-seed (idempotent via existence check, on-conflict, or delete-first)
- [ ] #3 A SUPABASE_INTEGRATION=1 test (e.g. iterations-insert-lockdown) passes immediately after a bare 'supabase db reset' with no manual seed step
<!-- AC:END -->
