---
id: TASK-132
title: 'My Work frontend: draggable Kanban columns, drop the current-iteration toggle'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 12:35'
updated_date: '2026-07-21 13:14'
labels: []
dependencies:
  - TASK-131
priority: high
type: feature
ordinal: 12900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-14 (My Work Kanban rework). Replaces MyWorkSections' static vertically-stacked lists with real draggable Kanban columns (Todo/Today/Doing/Done, side by side), reusing this repo's existing dnd-kit drag patterns from kanban-columns-board.tsx rather than inventing a new one. Removes the now-obsolete 'Only current iteration' toggle (My Work no longer tracks any project's current iteration at all). Wires drags to TASK-131's server actions and surfaces its 'No active iteration' error as a banner.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 MyWorkSections (or its replacement) renders Todo/Today/Doing/Done as side-by-side draggable Kanban columns using this repo's existing dnd-kit patterns (kanban-columns-board.tsx), not a new drag implementation
- [ ] #2 The 'Only current iteration' toggle and its filtering logic are removed entirely
- [ ] #3 Dragging a card between columns calls the appropriate TASK-131 server action (Today/Todo = local-only, Doing/Done = mapped-or-local) and optimistically updates, matching this repo's existing drag-failure-rollback conventions (TASK-113's fix: revert only the dragged card, not the whole board)
- [ ] #4 set_story_state's 'No active iteration' error (mapped Doing/Done drag into a project with no current iteration) surfaces as a visible banner, not a silent failed drag
- [ ] #5 Per-project accent color (project-color.ts) and row content carry over from the current implementation
- [ ] #6 fable-advisor design review against spec/ux-principles.md passes
- [ ] #7 spec/screens.md 'My Work' section rewritten to match doc-14
- [ ] #8 pnpm test + lint green
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-sonnet-5
created: 2026-07-21 13:14
---
Code review (2026-07-21) on the current my-work-sections.tsx found the Todo and Done sections hand-roll the same outer <section>/<h2> shell that the file's own Section component already provides and that Today/Doing already use -- a reuse gap, not a bug. Since AC #1 of this task replaces the whole static-sections layout with draggable Kanban columns, this is expected to be moot once implemented; flagging only so the same duplication doesn't get carried into the new column components.
---
<!-- COMMENTS:END -->
