---
id: TASK-131
title: >-
  My Work backend: classification rework + drag write-path (set_story_state,
  mapped/unmapped)
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 12:35'
updated_date: '2026-07-22 01:58'
labels: []
dependencies:
  - TASK-130
priority: high
type: feature
ordinal: 12800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-14 (My Work Kanban rework). Replaces buildMyWorkSections with the new 4-column classification (Done via story_completions > Today via is_today > Doing/Todo via mapped-state-or-local_status), and reworks my-work/page.tsx to drop the current-iteration fetching/rollover batch (no longer needed -- Today is a pure personal marker, not iteration-derived). Implements the drag write-path: To Today/Todo are always my_work_story_state-only writes (never touch the project); To Doing/Done call set_story_state alone (not move_story_board -- no board-position/optimistic-concurrency need here) when the project has a mapping, else upsert my_work_story_state.local_status. See .backlog/docs/doc-14 'Classification' and 'Dragging a card' sections for the exact logic (fable-advisor approved-with-changes).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 New classification function (replacing buildMyWorkSections) implements the precedence exactly as doc-14 specifies: story_completions row for viewer -> Done (one entry per completion, live-joined to current story data, never deduped away); else assignee_id=viewer + is_today -> Today; else effective status (mapped: derived from real state_id: unmapped: local_status or derived from category) -> Doing/Todo
- [ ] #2 my-work/page.tsx drops all current-iteration fetching/rollover (projectsNeedingRollover, rolloverIterationSafely, fetchCurrentIteration) -- no longer read by classification
- [ ] #3 Drag-to-Today/Todo server action upserts my_work_story_state only, never calls any project-state RPC, regardless of mapping
- [ ] #4 Drag-to-Doing/Done server action calls set_story_state with the project's mapped state id when mapped; upserts my_work_story_state.local_status when unmapped
- [ ] #5 set_story_state's existing 'No active iteration' error (when a mapped in_progress-category target has no current iteration) is caught and surfaced as a visible error to the caller, not swallowed
- [ ] #6 'Pin to My Work' story-peek menu item removed for stories not in the viewer's My Work base scope (assigned to them); story_pins usage removed from my-work-row.tsx and story-peek-menu.tsx
- [ ] #7 Unit tests for the new classification function (precedence, mapped vs unmapped Doing/Done, Done showing a reassigned-away story, a story completed twice appearing as two Done entries)
- [ ] #8 pnpm test + lint green
- [ ] #9 story_pins table + its RLS/grants + story-pins.integration.test.ts are dropped (moved here from TASK-130 to keep main green — the drop is coupled to the TS removal in this task); move_story_to_project and remove_member are updated to stop referencing story_pins (drop the move carry-over; replace the remove_member purge with a my_work_story_state purge for the removed user's rows in that project)
- [ ] #10 database.types.ts regenerated after the story_pins drop; togglePin server action and all story_pins reads (my-work/page.tsx, story-peek-menu.tsx, my-work-row.tsx) removed so tsc/lint/pnpm test stay green
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-sonnet-5
created: 2026-07-21 13:14
---
Code review (2026-07-21) on the current my-work/page.tsx + my-work-sections.tsx found: (1) buildMyWorkSections is invoked twice per render just to derive a boolean (hasFilterableItems) -- duplicated classify/sort/group pass; (2) my-work/page.tsx's current-iteration query duplicates the same selection rule already hand-rolled in dashboard/page.tsx and board/page.tsx. AC #1/#2 of this task already replace buildMyWorkSections and drop all current-iteration fetching from my-work/page.tsx, so both are expected to be resolved as a side effect -- flagging so they're not silently reintroduced in the rewrite, not asking for separate tracking. (dashboard/page.tsx and board/page.tsx will still independently duplicate the current-iteration selection rule between just the two of them after this lands -- judged too small to warrant its own task, mentioning for awareness only.)
---

author: @claude-opus-4-8
created: 2026-07-22 01:58
---
Design gap surfaced by TASK-130's /code-review (must resolve here): doc-14's write-path sends an UNMAPPED-project drag-to-Done to my_work_story_state.local_status='done' with NO story_completions row (no real state transition). But the classification makes Done story_completions-only, and its step 4 maps only effective 'doing'->Doing (else Todo). So local_status='done' currently routes to Todo, not Done. Resolve one of: (a) classification routes local_status='done' -> Done for unmapped projects; (b) unmapped Done is disallowed in the UI; (c) restrict the my_work_story_state.local_status CHECK to ('todo','doing') (would need a follow-up migration). The (user_id, completed_at) index also doesn't cover the stories SELECT OR-clause's (story_id, user_id) lookup — add a story_completions(story_id) index if the leaver-read path ever gets hot (low priority; OR short-circuits behind is_project_member today).
---
<!-- COMMENTS:END -->
