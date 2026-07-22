---
id: TASK-141
title: 'My Work redesign: free-column management UI (add/rename/delete/reorder)'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 08:53'
labels: []
dependencies:
  - TASK-140
priority: medium
type: feature
ordinal: 400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-15 (advisor-approved). My Work board renders required Todo/Today/Done plus the user's my_work_columns as additional draggable-target columns, in the user's chosen display order (the order covers the three fixed slots too - per-user ordered list, mechanism free). Column management UI on the My Work page: add (name), rename, delete (cards fall back to Todo via the composite FK's SET NULL), and reorder columns. Free-column drops write my_work_story_state.column_id only (local - never a project write). Reuses the existing dnd-kit patterns; ends with the fable-advisor ux-principles design review per CLAUDE.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Board renders fixed + free columns in the user's display order; order is editable and persists
- [ ] #2 Add/rename/delete free columns from the My Work page; deleting a column returns its cards to Todo with no error
- [ ] #3 Dragging any story into a free column is a local-only column_id write (unit-tested routing)
- [ ] #4 fable-advisor design review against spec/ux-principles.md passes
- [ ] #5 pnpm test + lint green (from apps/web/)
<!-- AC:END -->
