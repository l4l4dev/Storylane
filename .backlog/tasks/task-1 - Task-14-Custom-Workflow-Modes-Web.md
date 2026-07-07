---
id: TASK-1
title: 'Task 14: Custom Workflow Modes (Web)'
status: Done
assignee:
  - '@claude'
created_date: '2026-07-07 08:44'
updated_date: '2026-07-07 09:15'
labels: []
dependencies: []
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a workflow mode chosen at project creation and fixed afterwards. pivotal = existing List/Kanban board (unchanged); free = pure Trello board with DB-driven custom status columns, any-to-any drags, no iterations/velocity (points badge stays). Scope decisions are recorded in TASK.md Task 14 and spec updates. Migration 20260707000007 (projects.workflow_mode + custom_statuses + stories.custom_status_id) is applied locally; creation dialog/action already branch on mode.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Free-mode board renders DB-driven columns with any-to-any drag and per-column quick-add
- [x] #2 Pivotal-mode board behavior is unchanged (no regressions in existing tests)
- [x] #3 Settings has status management (add/rename/color/is_done/reorder/delete; delete blocked while stories reference it) for free projects only
- [x] #4 Story detail hides state transition buttons and shows a status selector for free projects
- [x] #5 Iterations nav/page hidden or empty-stated for free projects; ensureCurrentIteration never runs for them
- [x] #6 tsc, eslint, vitest, pnpm build pass; reviewers run; specs (screens/data-model) updated
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Harden migration: composite FK so stories.custom_status_id can't reference another project's status
2. Free board component (DB-driven columns, any-to-any dnd, per-column quick-add) + server actions (dropStoryFree, quickCreateStoryFree, status CRUD)
3. Board page branches on workflow_mode; free skips ensureCurrentIteration/iterations
4. Story detail: status selector instead of transition buttons for free projects
5. Settings: status management section (free only); hide iteration fields
6. Sidebar hides Iterations for free projects
7. Verify (tsc/eslint/vitest/build + browser), update specs, review, commit
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Session handoff 2026-07-07: implementation written but unverified (tsc was about to run). See docs/handoff-2026-07-07.md for the exact resume point — start by fixing the story-detail-panel.test.tsx fixture (StoryDetail gained workflowMode/customStatusId/customStatuses), then tsc/eslint/vitest/build, browser check, spec+TASK.md updates, reviewer, commit.

Resumed from docs/handoff-2026-07-07.md: fixed story-detail-panel.test.tsx fixture (workflowMode/customStatusId/customStatuses), tsc/eslint/vitest(181 tests)/pnpm build all pass. Browser-verified: Free project creation, default 3 columns, quick-add, any-to-any drag, story detail status select, Settings status add/rename/reorder/delete (FK-blocked delete confirmed), pivotal project unaffected (iteration bar/List/Kanban/Icebox/transition buttons all intact). web-conventions-reviewer flagged missing free-mode test coverage -> added test cases to story-detail-panel.test.tsx and quick-add-composer.test.tsx (181 tests now pass). rls-security-reviewer (light re-check) confirmed composite FK closes cross-project reference gap and RLS policies are complete. Updated spec/screens.md (Free mode board section) and spec/data-model.md (workflow_mode, custom_statuses, custom_status_id). Committed as f57f362 (+ 9514b52 fixing an accidental .backlog/config.yml inclusion).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Task 14 complete: workflow_mode ('pivotal'/'free') fixed at project creation; free mode is a pure Trello board driven by custom_statuses (any-to-any drag, per-column quick-add, Settings status CRUD, story detail status select), pivotal mode unchanged. Verified via tsc/eslint/vitest/build + browser walkthrough; reviewed by web-conventions-reviewer and rls-security-reviewer.
<!-- SECTION:FINAL_SUMMARY:END -->
