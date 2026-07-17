---
id: TASK-60
title: >-
  Fix note-above-header cosmetic quirk and InsertBetweenRows' silent break
  failures
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-12 10:29'
updated_date: '2026-07-17 13:16'
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
- [ ] #1 Decide and implement (or explicitly document) the correct group attribution for a note inserted directly above an auto-split group's header
- [ ] #2 InsertBetweenRows' insertIterationBreak awaits createBacklogDivider and reports failure via onError instead of failing silently
- [ ] #3 Tests cover both
- [ ] #4 DividerRow's note delete awaits deleteBacklogDivider and reports failure via onError (currently void, no catch — board-list-view.tsx:188-195)
- [ ] #5 InsertBetweenRows' submitNote clears the input and closes only after success; failure keeps the typed text and reports via onError (currently clears first, then fire-and-forget — board-list-view.tsx:572-576)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-07-17 fable-advisor UX review: scope extended — the same fire-and-forget pattern exists in DividerRow.handleDelete and InsertBetweenRows.submitNote (which also destroys the typed note text on failure). Added as AC#4/#5 alongside the original insertIterationBreak fix.
<!-- SECTION:NOTES:END -->
