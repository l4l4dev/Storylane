---
id: TASK-142
title: >-
  finalize_iteration: re-check role after advisory lock (TOCTOU, same class as
  TASK-116)
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-22 09:04'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during TASK-116 (comment there, 2026-07-22): doc-13's claim that finalize_iteration 're-derives authorization after the lock' is wrong - it has the same TOCTOU hole the cadence RPCs had: role is checked before acquiring the advisory lock, so a caller de-membered while blocked on the lock still executes the finalization. Fix with the exact TASK-116 pattern: re-run require_project_role() immediately after lock acquisition (READ COMMITTED gives each statement a fresh snapshot), unifying pre/post guards on the require_project_role helper (spec/rls.md 'RPC role guards'). Full-function replacement migration; finalize_iteration is the shared lazy-rollover/manual-finish path, so behavior must stay otherwise identical. Add a deterministic concurrency test like TASK-116's (raw pg connection holds the lock -> revoke -> expect 42501); pg devDependency already available.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 New migration redefines finalize_iteration with require_project_role re-checked after the advisory lock; body otherwise verbatim
- [ ] #2 Deterministic concurrency test: caller de-membered while blocked on the lock gets 42501 and no finalization side effects
- [ ] #3 rls-security-reviewer pass on the migration
- [ ] #4 SUPABASE_INTEGRATION suite + pnpm test + lint green (from apps/web/)
<!-- AC:END -->
