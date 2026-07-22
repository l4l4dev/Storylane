---
id: TASK-128
title: >-
  seed.sql is not idempotent — db reset leaves no dev user, breaking integration
  tests
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 11:18'
updated_date: '2026-07-22 16:45'
labels: []
milestone: m-2
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
- [x] #1 supabase db reset (clean) completes seeding without error and creates dev@storylane.local
- [x] #2 The vault.create_secret calls for slack_notify_url/slack_notify_secret no longer abort on a re-seed (idempotent via existence check, on-conflict, or delete-first)
- [x] #3 A SUPABASE_INTEGRATION=1 test (e.g. iterations-insert-lockdown) passes immediately after a bare 'supabase db reset' with no manual seed step
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Guarded seed.sql's two vault.create_secret calls (slack_notify_url/slack_notify_secret) with an existence check (do block, if not exists against vault.secrets) instead of calling them unconditionally. Root cause: supabase db reset runs the whole seed.sql as one transaction, so the vault duplicate-key error on a re-seed previously rolled back the entire seed including the already-succeeded auth.users insert, leaving no dev user at all. Verified: ran supabase db reset twice in a row -- both succeeded with no error, dev@storylane.local present both times, vault secrets present exactly once each (no duplication). SUPABASE_INTEGRATION=1 lib/utils/iterations-insert-lockdown.integration.test.ts (2 tests) passed immediately after the bare second reset, no manual seed step. tsc/lint green, full suite 601 passed.
<!-- SECTION:FINAL_SUMMARY:END -->
