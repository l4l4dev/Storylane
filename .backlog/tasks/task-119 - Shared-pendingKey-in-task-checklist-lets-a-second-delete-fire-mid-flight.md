---
id: TASK-119
title: Shared pendingKey in task-checklist lets a second delete fire mid-flight
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 11:00'
updated_date: '2026-07-21 14:55'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 11600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 finding #11. apps/web/components/features/story/task-checklist.tsx:29 uses one shared pendingKey string (not per-task) for every task's busy-lock. Clicking Delete on task A then Toggle on task B before A resolves re-enables A's Delete button while A's delete is still in flight.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 task-checklist.tsx's busy-lock is scoped per-task (not one shared pendingKey), so a second task's action can never re-enable a different task's in-flight control
- [x] #2 A test proves the double-delete race is closed
- [x] #3 pnpm test + lint green
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. apps/web/components/features/story/task-checklist.tsx: replace the single shared pendingKey (string|null) with a pendingKeys Set<string>, updated immutably (new Set(prev).add/delete) in run()'s start/finally. Each control's disabled check switches from 'isPending && pendingKey === key' to 'pendingKeys.has(key)' -- drops the now-redundant isPending (useTransition's flag was never precise enough on its own).
2. Add a regression test: start a Delete on task A (deferred/pending), start a Toggle on task B before A resolves, assert A's Delete stays disabled and a second click on it doesn't re-fire deleteTask; resolve A and confirm it re-enables.
3. Verify the new test actually fails against the pre-fix shared-key code (git stash the fix, rerun, confirm red; restore).
4. Run pnpm test + pnpm run lint + tsc --noEmit.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fix: task-checklist.tsx now tracks pending keys in a Set instead of one shared string, so each task's toggle/delete button disables only itself -- a second task's action starting can no longer re-enable a different task's in-flight control. Test: new case in task-checklist.test.tsx reproduces the exact doc-13 scenario (Delete A, then Toggle B before A resolves) and asserts A's Delete stays disabled and doesn't double-fire -- confirmed this test fails on the pre-fix shared-pendingKey code (manually verified via git stash) and passes with the fix. Verified: pnpm exec vitest run on the file (10/10 pass), pnpm run lint clean, pnpm exec tsc --noEmit clean, full pnpm test (563 passed, 186 pre-existing skips, 0 failed).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
task-checklist's busy-lock is now scoped per-task (a Set of pending keys) instead of one shared key, so starting an action on one task can no longer re-enable a different task's still-in-flight control and risk a duplicate delete. Verified via a new regression test (confirmed to fail pre-fix, pass post-fix) plus full pnpm test (563 passed), lint, and tsc --noEmit (all clean).
<!-- SECTION:FINAL_SUMMARY:END -->
