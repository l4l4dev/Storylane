---
id: TASK-131
title: >-
  My Work backend: classification rework + drag write-path (set_story_state,
  mapped/unmapped)
status: In Progress
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 12:35'
updated_date: '2026-07-22 02:21'
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
- [ ] #11 ROUND-4 (advisor-approved 2026-07-22, resolves the TASK-130-review gap): Done is an ADDITIVE axis, not exclusive — a story with any story_completions row for the viewer ALWAYS shows as Done (one entry per row), AND unmapped-project local_status='done' also classifies as Done (a cancellable local mark, NOT a permanent completion log — comment this asymmetry). Todo/Today/Doing are evaluated INDEPENDENTLY of completion history, gated only by 'current real category != done' (assignee=viewer, non-Icebox), applying the existing is_today/mapped-state/unmapped-local_status logic. Consequence: a story completed before and now reopened + in_progress + assigned to the viewer appears in BOTH Done (log) and Doing (live) simultaneously.
- [ ] #12 ROUND-4 unit tests (added to AC #7's set): (a) unmapped local_status='done' -> Done; (b) past completion + currently reopened in_progress + assigned -> appears in BOTH Done and Doing; (c) mapped project whose real state is still done but local_status set to 'todo' -> does NOT appear in Todo/Doing (no-op, since 'To Todo' never calls set_story_state), Done log still present
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
IMPLEMENTATION SLICES (design unblocked — advisor round 4 in ACs #11/#12 + comment; schema live from TASK-130 migration 20260722000002; database.types.ts already regenerated with the 3 new tables). Do in order, /code-review between commits:

SLICE 1+2 (land together — the type change cascades): Classification (AC #1/#7/#11/#12) in apps/web/lib/utils/my-work.ts — replace buildMyWorkSections. New MyWorkStory: id, projectId, position, category (real StateCategory, non-null), isToday, localStatus (todo/doing/done/null), mapped (bool). assignedColumn(story): category===done -> null (Done via completion); effective = mapped ? (in_progress?doing:todo) : (localStatus ?? (in_progress?doing:todo)); effective===done -> done (unmapped local mark, outranks Today); isToday -> today; else effective. Done column = story_completions entries (incl. reassigned-away) + assigned stories whose assignedColumn===done. Keep groupDoneByDate. Then my-work/page.tsx (AC #2): drop projectsNeedingRollover/rolloverIterationSafely/fetchCurrentIteration + current-iteration batch; new queries = assigned non-Icebox stories + my_work_story_state join, project_my_work_mapping per project (mapped = doing_state_id points to a LIVE in_progress-category state), story_completions for viewer live-joined for Done. The old MyWorkStory + buildMyWorkSections are used by page.tsx + MyWorkSections + my-work-sections.test/my-work-row.test, so keep tsc green across the swap. Unit tests: precedence, mapped vs unmapped Doing/Todo, unmapped local done -> Done, past-completion+reopened-in_progress -> BOTH Done and Doing, mapped real-still-done + local todo -> not in Todo/Doing.

SLICE 3 — drag write-path server actions (AC #3/#4/#5): To Today/Todo = my_work_story_state upsert only, never a project RPC. To Doing/Done = mapped ? set_story_state(story, mapped_state_id) ONLY (not move_story_board) : upsert local_status. Catch set_story_states No active iteration error and surface it. (Consumed by TASK-132 UI.)

SLICE 4 — story_pins teardown (AC #6/#9/#10): NEW migration drops story_pins table+RLS+grants; update move_story_to_project (remove pin carry-over) + remove_member (replace story_pins purge with a my_work_story_state purge) verbatim-plus-change like 20260720000005. Remove togglePin + all story_pins reads (my-work/page.tsx, story-peek-menu.tsx, my-work-row.tsx) + the Pin to My Work menu item + story-pins.integration.test.ts. Regen types. db reset + rls-security-reviewer + test/lint.

GOTCHAS: 2 PRE-EXISTING integration failures unrelated to this work (move-copy label-dedup vs labels_unique_name; finish-story-from-git vs iterations INSERT lockdown) — file separately, do not chase. To Todo never calls set_story_state (a mapped real-done story stays in Done via that drag — expected, test it).
<!-- SECTION:PLAN:END -->

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

author: @claude-opus-4-8
created: 2026-07-22 02:17
---
fable-advisor round 4 (2026-07-22) resolution of the unmapped-Done + reopen-precedence gaps — owner-approved, recorded here (doc-14 round-4 addendum deferred to save a 400-line CLI rewrite; ACs #11/#12 are the implementation contract). Q1: option (a) — classification treats unmapped local_status='done' as Done; mapped Done = permanent story_completions log, unmapped Done = cancellable local mark (accepted asymmetry, within doc-14 round-1's 'unmapped is a permanent divergence' stance; round-2's 'never disappears' was contextually about mapped/real progress). (b)/(c) rejected: (c) the CHECK already shipped in TASK-130 and 'done' stays valid under (a); (b) would silently retract the owner-approved 'unmapped Doing/Done upserts local_status' write path. Q2: doc-14's 'Done > Today > Doing > Todo' EXCLUSIVE precedence was internally contradictory (step 2's 'currently not done' = current state, but step 1 keyed on completion HISTORY). Fix = additive: Done (completion rows, + unmapped local_status='done') always shows; Todo/Today/Doing gated only by current-real-category-not-done, independent of history; a reopened active story shows in both. Note for tests: 'To Todo' never calls set_story_state, so a mapped story whose real state stays done won't leave Doing/Done via that drag.
---
<!-- COMMENTS:END -->
