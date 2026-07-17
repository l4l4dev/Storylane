---
id: TASK-60
title: >-
  Fix note-above-header cosmetic quirk and InsertBetweenRows' silent break
  failures
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-12 10:29'
updated_date: '2026-07-17 14:55'
labels:
  - web
  - ux
milestone: m-0
dependencies: []
priority: low
ordinal: 700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two pre-existing, lower-priority issues flagged by fable-advisor review during TASK-42 (not regressions TASK-42 introduced — both predate it): (1) 'Insert note above' on the first story of an automatic (capacity-split) group renders the note above that group's header instead of below it, because buildBacklogRows attributes a boundary-adjacent note to the still-open previous group (same anchor the old hover-line always used) — a manual-break-created group doesn't have this asymmetry. Needs an owner call: fix the attribution, or document it as accepted behavior. (2) InsertBetweenRows' insertIterationBreak (board-list-view.tsx) is still fire-and-forget (void createBacklogDivider(...), no await/catch) — a failure is silent, the same TASK-22 pattern RowInsertMenu's equivalent path was fixed to avoid. Bring it in line: await + report via the shared MutationErrorBanner (onError, same wiring RowInsertMenu now uses).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Decide and implement (or explicitly document) the correct group attribution for a note inserted directly above an auto-split group's header
- [x] #2 InsertBetweenRows' insertIterationBreak awaits createBacklogDivider and reports failure via onError instead of failing silently
- [x] #3 Tests cover both
- [x] #4 DividerRow's note delete awaits deleteBacklogDivider and reports failure via onError (currently void, no catch — board-list-view.tsx:188-195)
- [x] #5 InsertBetweenRows' submitNote clears the input and closes only after success; failure keeps the typed text and reports via onError (currently clears first, then fire-and-forget — board-list-view.tsx:572-576)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed buildBacklogRows' note attribution (owner chose to fix, not document): notes are held in a pendingNotes buffer and only flushed once the next story/break resolves whether a capacity split or manual break happens first — a capacity split flushes into the group it opens, a manual break flushes into the group it closes (matching its pre-existing correct behavior). Fixed 3 fire-and-forget mutations in board-list-view.tsx (DividerRow.handleDelete, InsertBetweenRows.insertIterationBreak, InsertBetweenRows.submitNote) to await+catch and report via the shared onError->MutationErrorBanner wiring RowInsertMenu already used; submitNote now only clears/closes on success, preserving typed text on failure. Exported DividerRow/InsertBetweenRows (previously untested) and added direct component tests.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
fable-advisor review (2026-07-17): approve-with-fixes. Verified the buildBacklogRows fix against every note/break interleaving edge case by hand-tracing, confirmed both fire-and-forget fixes satisfy spec/ux-principles.md principle 2, and confirmed the SortableListRow no-op onError is genuinely unreachable (Current/Icebox containers never hold divider-kind items, checked via toListItemContainers and isAllowedMove). Required 2 fixes applied: corrected a doc-comment that had the manual-break attribution backwards (code was already correct), and added the 2 edge-case tests the advisor named (note-before-manual-break, trailing-note-with-nothing-after). Verified via 30 iterations.test.ts + 15 board-list-view.test.tsx tests (both new) + tsc + eslint + full suite (423/423). Owner deferred manual browser verification to bulk pre-deploy pass (2026-07-17) — not blocking completion.
<!-- SECTION:FINAL_SUMMARY:END -->
