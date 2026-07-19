---
id: TASK-61
title: >-
  Make IterationGoalInput (Backlog virtual-group goals) click-to-edit like
  IterationGoalBar
status: Done
assignee:
  - '@codex-gpt-5'
created_date: '2026-07-14 03:15'
updated_date: '2026-07-18 02:03'
labels:
  - web
  - ux
milestone: m-0
dependencies:
  - TASK-79
priority: low
ordinal: 800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
fable-advisor review during TASK-45 flagged: IterationGoalInput (board-list-view.tsx, the always-visible small input on each Backlog virtual-iteration group header) still renders as a permanently-visible input, unlike the current iteration's own goal (IterationGoalBar, kanban-board.tsx) which TASK-45 converted to click-to-edit text per spec/ux-principles.md principle 5. Not flagged as a hard violation (border-transparent makes it read text-like at rest), but the two goal-editing UIs now behave differently for what's conceptually the same field. Bring IterationGoalInput in line with IterationGoalBar's pattern: text view (or ghost placeholder) by default, click to edit, Enter/blur commits and returns to text (only on success), Esc discards. Reuse or extract the commit/race-guard/focus-restore logic IterationGoalBar now has rather than re-deriving it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 IterationGoalInput renders as text (or ghost placeholder) by default; clicking opens an editable input
- [x] #2 Same commit/race/focus-restore guarantees as IterationGoalBar (no double-submit, no lost error on a losing race, focus returns to the text view after closing)
- [x] #3 Tests cover the same scenarios kanban-board.test.tsx's IterationGoalBar suite does
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
NOTE (code review 2026-07-16): when extracting IterationGoalBar's commit/race-guard/focus-restore logic, make the extraction a shared <InlineEdit> (or hook) that free-board.tsx's AddColumnButton and ColumnNameEditor can also adopt — they carry the same readOnly={isPending} blur pattern but lack the savingRef double-submit guard IterationGoalBar has (the trio has already drifted).
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-18 01:11
---
Implemented as 58361af on feat/ux-panel-high-fixes (Codex gpt-5). New shared useInlineEdit hook; IterationGoalBar migrated onto it too; free-board rename/add-column got the same race guard per implementation notes. Verified: vitest 436 passed / 102 skipped, 0 failures. Pending: review + merge with TASK-79/52.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
IterationGoalInput is click-to-edit via new shared useInlineEdit hook (58361af, hardened in ef0f7ca: draft-preserving prop sync, keyboard-only focus restore); IterationGoalBar migrated onto the same hook, free-board rename/add-column adopted the race guard per implementation notes. Verified: Enter/blur/Escape/IME/failure/race/focus-restore tests added; suite 442 passed / 0 failures. Implemented by Codex gpt-5.
<!-- SECTION:FINAL_SUMMARY:END -->
