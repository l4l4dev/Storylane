---
id: TASK-132
title: 'My Work frontend: draggable Kanban columns, drop the current-iteration toggle'
status: In Progress
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 12:35'
updated_date: '2026-07-22 04:43'
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
- [x] #1 MyWorkSections (or its replacement) renders Todo/Today/Doing/Done as side-by-side draggable Kanban columns using this repo's existing dnd-kit patterns (kanban-columns-board.tsx), not a new drag implementation
- [x] #2 The 'Only current iteration' toggle and its filtering logic are removed entirely
- [x] #3 Dragging a card between columns calls the appropriate TASK-131 server action (Today/Todo = local-only, Doing/Done = mapped-or-local) and optimistically updates, matching this repo's existing drag-failure-rollback conventions (TASK-113's fix: revert only the dragged card, not the whole board)
- [ ] #4 set_story_state's 'No active iteration' error (mapped Doing/Done drag into a project with no current iteration) surfaces as a visible banner, not a silent failed drag
- [x] #5 Per-project accent color (project-color.ts) and row content carry over from the current implementation
- [x] #6 fable-advisor design review against spec/ux-principles.md passes
- [x] #7 spec/screens.md 'My Work' section rewritten to match doc-14
- [x] #8 pnpm test + lint green
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-sonnet-5
created: 2026-07-21 13:14
---
Code review (2026-07-21) on the current my-work-sections.tsx found the Todo and Done sections hand-roll the same outer <section>/<h2> shell that the file's own Section component already provides and that Today/Doing already use -- a reuse gap, not a bug. Since AC #1 of this task replaces the whole static-sections layout with draggable Kanban columns, this is expected to be moot once implemented; flagging only so the same duplication doesn't get carried into the new column components.
---

author: @claude-sonnet-5
created: 2026-07-22 03:32
---
Implemented on branch feat/task-131-my-work-backend (same branch as TASK-131, on top of its 3 commits, not yet committed here). Files: lib/utils/my-work.ts (+toDragContainers/regroupByProject), components/features/my-work/my-work-sections.tsx (full rewrite: DndContext/sensors/DragOverlay reusing kanban-columns-board.tsx's exact pattern + useOptimisticBoardOrder unmodified), my-work-row.tsx (+completedAt marker), app/my-work/actions.ts (+isRealCategoryDone guard), app/my-work/page.tsx (width), spec/screens.md + spec/rls.md + spec/data-model.md + spec/features.md + spec/glossary.md + ARCHITECTURE.md (story_pins fully scrubbed, doc-14 My Work rewritten).

fable-advisor design review (AC #6): initial pass found 2 required fixes (both resolved, re-review confirmed):
1. Principle 2 — dragging an already-real-done story to Todo/Today/unmapped-Doing was a silent DB-write-succeeds-but-classification-ignores-it no-op (card would snap back on next revalidate with no explanation). Fixed: actions.ts's isRealCategoryDone guard rejects with a visible message before reaching the local-only write. 4 new tests.
2. Principle 9 — Done is additive (TASK-131 AC#12b), so the same story can render as a live Doing card AND a Done log entry simultaneously with no visual distinction. Fixed: MyWorkRow's completedAt prop renders a CircleCheckBig marker only on Done-column instances. 3 new tests (no-marker/has-marker/dual-appearance-only-one-marked).

Verification: tsc + lint green; my-work-scoped tests 38 passed (classification, drag-container id uniqueness incl. Done duplicate-story collision safety, server action routing incl. the new guard, completion marker). Full suite 583 passed.

Browser verification (manual, via claude-in-chrome): logged in as dev user, confirmed (a) all 4 columns render side-by-side with counts even empty, (b) empty-state message, (c) quick-add creates a story that appears correctly grouped under its project in Todo with accent color/type icon/state badge/project chip, (d) clicking a card still navigates to /stories/[id] (drag doesn't swallow clicks), (e) 'Pin to My Work' is confirmed GONE from the story peek overflow menu, (f) keyboard-based drag (Space to lift, arrow keys, Escape) engages dnd-kit and Escape correctly cancels+reverts with no server call. Test data (2 stories) created and deleted during verification.

GAP — could not automate the actual cross-column POINTER drag (AC #3/#4's core interaction): both the computer-tool's click-drag and raw synthetic PointerEvent dispatch (pointerdown+multiple pointermove+pointerup via JS) failed to register with dnd-kit's PointerSensor. This is a known dnd-kit browser-automation limitation, not specific to this implementation — it reuses kanban-columns-board.tsx's identical sensor setup, and that board has zero component-level drag tests in this repo for the same reason. AC #3 and #4 left UNCHECKED pending the owner's own manual drag-and-drop check (see kakunin-tejun steps).
---

author: @claude-sonnet-5
created: 2026-07-22 04:43
---
Drag confirmed working by owner (2026-07-22): cards do move columns within My Work now. Fixed a real regression along the way (see commit d473383): handleDragEnd was comparing the dragged card's container as re-derived from already-optimistically-moved state, so the server call never fired on any cross-column drop -- card would lift/follow the cursor but silently revert on the next refresh. Fixed with a drag-start-captured ref + resolveDragEndTarget pure function (4 new tests). Also fixed an unrelated pre-existing gap noticed while dogfooding: /dashboard had no sidebar at all, losing the My Work nav link (commit 68b9ba2).

AC #4 (the 'No active iteration' banner) remains unchecked: it only fires for a MAPPED project's Doing/Done drag, and no project can be mapped yet (TASK-133's Settings UI doesn't exist). The code path itself is implemented and unit-tested (actions.test.ts's 'surfaces No active iteration' case), but end-to-end verification needs TASK-133 to land first. Owner has asked to proceed to TASK-133 next; will close out this AC once a mapped project makes the scenario reachable.
---
<!-- COMMENTS:END -->
