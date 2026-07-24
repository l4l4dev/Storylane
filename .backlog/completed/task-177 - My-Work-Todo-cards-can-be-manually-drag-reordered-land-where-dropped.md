---
id: TASK-177
title: 'My Work: Todo cards can be manually drag-reordered (land where dropped)'
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-23 14:22'
updated_date: '2026-07-23 23:19'
labels: []
milestone: m-2
dependencies:
  - TASK-176
references:
  - apps/web/lib/utils/my-work.ts
  - apps/web/app/my-work/actions.ts
  - apps/web/components/features/my-work/my-work-sections.tsx
  - supabase/migrations/20260722000002_my_work_data_model.sql
priority: medium
type: feature
ordinal: 2200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner-reported: dragging a Todo card to reorder it doesn't stick — it snaps back to the story's raw board position (backlog order) on refresh, reading as 'auto-sorting'. Todo has no persisted manual order, unlike Today (today_position) and free columns (column_position).

Depends on and shares infrastructure with TASK-176 (Done-as-status refactor) — do TASK-176 first. fable-advisor verdict (2026-07-24):
- Add a todo_position int column to my_work_story_state (NOT a unified single position column — Today overlays a free column so today_position and column_position must coexist; the previously-considered unification is impossible).
- CHECK constraint: todo_position is null OR (today_date is null AND column_id is null) — i.e. only meaningful when the row actually classifies to Todo. Back it with a DB reset trigger (extend the existing my_work_story_state_reset_* trigger), not just app code, because setMyWorkColumn's per-branch manual field-nulling is exactly what caused TASK-161's paired-field bug.
- classifyMyWork's Todo sort: use todo_position (nulls last), falling back to the story's raw board position for never-reordered stories (keep today's default).
- Scope reorder per project group, not one flat Todo order (mirrors reorderMyWorkColumn re-densifying one free column's range). regroupByProject already groups Todo by project.
- New reorderMyWorkTodo action (same full-array-upsert shape as reorderMyWorkToday/reorderMyWorkColumn); add 'todo' to isManualOrderReorder.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Dragging a card to reorder within a Todo project group persists — it does not revert to board/backlog order on refresh
- [x] #2 A story new to Todo (never reordered) sorts by its board position among other not-yet-reordered stories, not an arbitrary jump
- [x] #3 Manual order is scoped per project group; a card reordered in one group's list doesn't renumber another group
- [x] #4 todo_position is null unless the row actually classifies to Todo (CHECK + DB reset trigger), so moving a card to Today/a free column clears it
- [x] #5 The migration gets an rls-security-reviewer pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shares TASK-176's migration approach. Added todo_position column + CHECK (todo_position null or (today_date null and column_id null)) and replaced the column_position-only reset trigger with my_work_story_state_reset_positions covering both column_position and todo_position. classifyMyWork sorts each Todo project group by todo_position (nulls last, board-position fallback). reorderMyWorkTodo action (full-array upsert like reorderMyWorkColumn); persistReorder scopes the persisted order to the dragged card's own project group. isManualOrderReorder now true for every same-container drop (Todo/Done included).

todo_position clearing: the reset trigger fires on today_date/column_id becoming non-null; a Done↔Todo transition leaves both null (same shape as Todo), so persistMark clears todo_position unconditionally on every placement (fable-advisor + rls-security-reviewer fix, shared with TASK-176's done_position).

Verified: full suite 719 pass, tsc/eslint clean, rls-security-reviewer PASS on the migration (todo_position CHECK + reset trigger verified live). Live Playwright: dragging a Todo card to the top persisted across reload (did not revert to board order).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Todo cards now persist their manual drag order (todo_position on my_work_story_state, scoped per project group), so a reordered card no longer snaps back to board/backlog order on refresh. Shares TASK-176's migration + reset-trigger. Verified live (reorder survives reload) + full suite; rls-security-reviewer pass recorded.
<!-- SECTION:FINAL_SUMMARY:END -->
