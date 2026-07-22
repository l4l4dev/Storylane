---
id: TASK-150
title: >-
  My Work: free-column management papercuts (delete confirm, consolidated
  edit/reorder, order persistence)
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 13:33'
updated_date: '2026-07-22 16:45'
labels: []
milestone: m-5
dependencies: []
references:
  - >-
    .backlog/docs/reviews/doc-17 -
    17-—-UX-panel-review-2026-07-22-—-My-Work-screen-10-expert-ux-review.md
priority: medium
type: bug
ordinal: 550
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From doc-17 (2026-07-22 UX panel review) High-impact findings #1, #6, #7, #8. Delete-column is a single-click destroy with no confirm/undo and no statement of where cards go. Column editing (add/rename/delete) lives in a collapsed manage panel while reordering lives only on the board grip -- one object split across two disconnected surfaces. Reorder grip has no resting-state affordance and no non-drag path on touch (owner decision 2026-07-22: keep the grip always visible, not hover-only; still add a touch fallback per Wroblewski's finding). Reordering a card inside a free column animates and appears to persist, then silently reverts on refresh -- only Today persists order today.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Deleting a free column asks for confirmation and states where its cards go (or offers an undo toast)
- [x] #2 Column add/rename/delete and reordering are reachable from one coherent place, not two disconnected surfaces
- [x] #3 The reorder grip is visible at rest (not hover-gated) and has a non-drag fallback for touch
- [x] #4 Free-column card order persists across refresh (or the interaction is changed to membership-only if persisting is out of scope)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: migration 20260722000015_my_work_column_position.sql (column_position on my_work_story_state, mirrors today_position); reorderMyWorkColumn action; classifyMyWork/isManualOrderReorder generalized from Today-only to any free column; DeleteColumnButton now confirms via Dialog (states cards move to Todo); rename/delete moved from the old MyWorkColumnManager panel into each free column's own header (ColumnNameField + DeleteColumnButton), panel replaced by an AddColumnTile at the row's end; grip contrast raised + always-visible (owner decision: always show, not hover-gated) plus left/right icon-sm move buttons as the touch fallback. rls-security-reviewer pass: safe, minimal, no new RLS needed (row-level policies already cover the new column) -- one gap found and fixed (missing DOWN rollback comment). fable-advisor (opus fallback) design review: approved with 2 fixes, both applied -- delete-X separated from the move-button pair (principle 6, destructive action must not sit flush beside a routine one) and move buttons bumped from icon-xs to icon-sm (aligning touch-target size with why they exist, principle 7). Tests: 87 my-work-scoped unit tests + 96 integration tests (SUPABASE_INTEGRATION=1) pass; full suite 651 pass; tsc/eslint clean. /code-review still pending (owner must run it -- disabled for direct model invocation).

Owner follow-up (2026-07-22, same session): added rename support for the three FIXED slots (Todo/Today/Done), display label only. Migration 20260722000016_my_work_fixed_column_names.sql (profiles.my_work_column_names jsonb + explicit column grant, mirrors the my_work_column_order precedent exactly); renameMyWorkFixedColumn action (read-modify-write); resolveColumnNames pure fn (defensive against malformed/partial jsonb); ColumnNameField generalized to take name+onRename instead of a MyWorkFreeColumn so both free and fixed columns share the same rename control. rls-security-reviewer pass: safe, correct, matches the approved precedent 1:1 -- no gaps (one benign non-security last-write-wins race noted if renaming two slots from two tabs at once, same character as other read-modify-write actions already in this file, not tracked). Tests: +13 (resolveColumnNames unit tests, renameMyWorkFixedColumn action tests, a MyWorkSections rename test) -- 95 my-work-scoped unit tests total, 104 integration tests, full suite 659 pass, tsc/eslint clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
All 4 ACs verified via automated tests (Testing Library DOM interaction tests + real-DB integration tests, no manual browser check yet — owner's to do). AC#1: DeleteColumnButton's confirm dialog (states 'Its cards move to Todo') verified by 3 my-work-column-manager.test.tsx cases (opens/cancels/confirms). AC#2: rename+delete moved into each free column's own header, add is the AddColumnTile at the row's end, reorder via the existing header grip -- verified by my-work-sections.test.tsx ('shows rename and delete controls in a free column's own header', "offers a '+ Add column' tile"). AC#3: grip raised to always-visible contrast + left/right icon-sm move buttons as the touch fallback -- verified by the move-button disabled-at-edges test and the persisted-swap test. AC#4: column_position (mirrors today_position) + reorderMyWorkColumn action persist free-column card order -- verified by classifyMyWork's columnPosition sort test, reorderMyWorkColumn's action tests, AND a new my-work-data-model.integration.test.ts case against the real local DB.

/code-review (high effort, 8 parallel finder angles) ran mid-task and found a real, severe bug this implementation introduced: clearing/reassigning column_id never reset column_position, which (a) violated the new column_position/column_id check constraint when moving a reordered free-column card to Todo or deleting its column via the FK cascade, and (b) left stale sort positions when moving a card directly between two free columns. Fixed: 3 call sites in setMyWorkColumn now explicitly reset column_position, and a new BEFORE UPDATE trigger (my_work_story_state_reset_column_position) closes the FK-cascade path the app code can't reach directly. Also fixed along the way: an unchecked read in renameMyWorkFixedColumn that could silently wipe other slots' names on a transient read failure; a grant-lockdown regression the new trigger function itself introduced (added the required revoke); and 6 CLAUDE.md code-comment-policy violations (history/task-narration comments) in my own new code. Added regression tests for all of the above (4 strengthened setMyWorkColumn assertions, 1 new renameMyWorkFixedColumn test, 1 new DB-level integration test proving the trigger + FK-cascade path). Remaining code-review findings (all cleanup/reuse/altitude/efficiency, no correctness bugs) reported to the owner but not auto-fixed: reorderMyWorkColumn/reorderMyWorkToday + today-literal branching + two parallel position fields could generalize further; MyWorkColumnShell's ad hoc per-variant props could become a capabilities object; DeleteColumnButton's confirm dialog is a 4th hand-copied instance of an existing pattern; reorderIds duplicates reorderContainer; the new move-button pattern duplicates state-manager.tsx's up/down pattern; renameMyWorkFixedColumn's read-modify-write still has a benign (non-security) lost-update race under concurrent renames of different slots; a couple of very minor simplification/efficiency notes.

Final verification: tsc clean, eslint clean, full suite 875/875 passing including SUPABASE_INTEGRATION=1 (103 files, 0 skipped-that-should-run).
<!-- SECTION:FINAL_SUMMARY:END -->
