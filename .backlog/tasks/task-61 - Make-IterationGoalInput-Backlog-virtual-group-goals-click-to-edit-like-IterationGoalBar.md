---
id: TASK-61
title: >-
  Make IterationGoalInput (Backlog virtual-group goals) click-to-edit like
  IterationGoalBar
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-14 03:15'
updated_date: '2026-07-15 23:54'
labels:
  - web
  - ux
milestone: m-0
dependencies: []
priority: low
ordinal: 45000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
fable-advisor review during TASK-45 flagged: IterationGoalInput (board-list-view.tsx, the always-visible small input on each Backlog virtual-iteration group header) still renders as a permanently-visible input, unlike the current iteration's own goal (IterationGoalBar, kanban-board.tsx) which TASK-45 converted to click-to-edit text per spec/ux-principles.md principle 5. Not flagged as a hard violation (border-transparent makes it read text-like at rest), but the two goal-editing UIs now behave differently for what's conceptually the same field. Bring IterationGoalInput in line with IterationGoalBar's pattern: text view (or ghost placeholder) by default, click to edit, Enter/blur commits and returns to text (only on success), Esc discards. Reuse or extract the commit/race-guard/focus-restore logic IterationGoalBar now has rather than re-deriving it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 IterationGoalInput renders as text (or ghost placeholder) by default; clicking opens an editable input
- [ ] #2 Same commit/race/focus-restore guarantees as IterationGoalBar (no double-submit, no lost error on a losing race, focus returns to the text view after closing)
- [ ] #3 Tests cover the same scenarios kanban-board.test.tsx's IterationGoalBar suite does
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
NOTE (code review 2026-07-16): when extracting IterationGoalBar's commit/race-guard/focus-restore logic, make the extraction a shared <InlineEdit> (or hook) that free-board.tsx's AddColumnButton and ColumnNameEditor can also adopt — they carry the same readOnly={isPending} blur pattern but lack the savingRef double-submit guard IterationGoalBar has (the trio has already drifted).
<!-- SECTION:NOTES:END -->
