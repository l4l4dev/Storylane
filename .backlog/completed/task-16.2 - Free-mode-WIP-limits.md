---
id: TASK-16.2
title: 'Free mode: WIP limits'
status: Done
assignee: []
created_date: '2026-07-07 14:28'
updated_date: '2026-07-09 10:00'
labels:
  - web
  - db
milestone: m-0
dependencies: []
references:
  - spec/screens.md
  - spec/data-model.md
parent_task_id: TASK-16
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per spec/screens.md and spec/data-model.md: custom_statuses.wip_limit (nullable, >0). Column header shows count/limit and turns warning-colored when count exceeds the limit; drops are never blocked (soft limit). Configured from the column header menu.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Migration adds custom_statuses.wip_limit; rls-security-reviewer has reviewed it
- [x] #2 Column header shows count/limit when set and turns warning-colored when exceeded; drag-and-drop is never blocked
- [x] #3 Limit editable (set/clear) from the column header menu
- [x] #4 Tests cover the over-limit indicator and limit editing
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation:
- Migration 20260709000006_free_mode_wip_limits.sql adds custom_statuses.wip_limit int check (wip_limit > 0), nullable.
- lib/utils/board.ts: isOverWipLimit(count, wipLimit) pure helper, tested (3 cases).
- settings/actions.ts: setStatusWipLimit server action (validates finite/positive, floors, empty string clears); project_id-scoped update.
- free-board.tsx: WipLimitMenu (Radix DropdownMenu + form) in each column header next to count; header shows 'count / limit' and turns orange when over; count/points/menu unaffected by drag validation (soft limit only).
- free-board.test.tsx (new): 4 tests for WipLimitMenu (save, clear-visible-only-with-limit, no-clear-without-limit, server-error-keeps-menu-open). Uses fireEvent.pointerDown to open the Radix trigger (opens on pointerdown, not click, in jsdom) — documented inline.

Incidental fix (user-approved, scope expanded on request): found 4 pre-existing project_id-scoping gaps in settings/actions.ts of the same class as TASK-18 (deleteLabel, updateCustomStatus, deleteCustomStatus, deleteIntegration all missing .eq('project_id', projectId)) — fixed all 4 in this change.

Review:
- rls-security-reviewer: no RLS gaps; migration/CHECK constraint verified live (NULL/positive allowed, 0/negative rejected); the 4 project_id-scoping fixes verified correct against each table's schema. Minor non-security suggestion: setStatusWipLimit doesn't special-case int4 overflow (e.g. '2147483648') — would surface a raw Postgres error instead of a friendly message. Left as-is (soft limit, edge case).
- web-conventions-reviewer: conventions OK (naming, types, patterns, Radix+FormData+startTransition mirrors FinishIterationButton). One suggestion applied: added inline comment in free-board.test.tsx documenting the pointerDown-vs-click Radix quirk.

Verification:
- tsc --noEmit / eslint / vitest: all clean.
- Live browser: created a Free/KanbanFlow test project, set Todo's WIP limit to 2, added 3 stories (3/2 rendered in orange warning color), added stories at/below limit rendered neutral, dragged a story out while over limit (never blocked), cleared the limit (reverts to plain count). No console errors. Test project deleted after verification.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Free-mode columns now support an optional per-column WIP limit (custom_statuses.wip_limit): editable via a kebab menu in the column header, displayed as count/limit and warning-colored when exceeded, purely advisory — drag-and-drop is never blocked. Full test coverage (unit + component) and live browser verification; two reviewer agents (RLS + web-conventions) found no blocking issues. Also fixed 4 incidental project_id-scoping gaps in settings/actions.ts discovered during this task (user-approved scope expansion).
<!-- SECTION:FINAL_SUMMARY:END -->
