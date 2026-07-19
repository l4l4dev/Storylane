---
id: TASK-73
title: IME composition guard for Escape/Enter across inline editors
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-17 13:15'
updated_date: '2026-07-17 14:12'
labels:
  - web
  - ux
milestone: m-0
dependencies: []
priority: medium
ordinal: 300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
fable-advisor UX review 2026-07-17 (should-fix before deploy — the owner types Japanese daily). story-detail-panel.tsx:222-233 established the isComposing guard pattern, but the Escape (and Enter-submit) handlers elsewhere don't check event.nativeEvent.isComposing, so cancelling an IME conversion with Esc closes the editor and destroys the typed text: quick-add-composer.tsx:103-107, kanban-board.tsx:405-411 (IterationGoalBar), board-list-view.tsx:266-270 (IterationGoalInput) and :600-604 (note input), free-board.tsx:378-381,464-469. Extract one shared helper and apply it to every inline editor's key handlers.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 During IME composition, Esc cancels the conversion only (editor stays open, text intact) and Enter commits the conversion only (no submit) in: quick-add composer, IterationGoalBar, IterationGoalInput, note input, free-board column editors
- [x] #2 Single shared guard helper; tests simulate composition events for at least the composer and one goal editor
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Extracted the story-detail-panel.tsx isComposing guard into a shared helper, lib/utils/keyboard.ts isImeComposing(event), and applied it to every Escape/Enter inline-editor handler named in the review: quick-add-composer.tsx (Escape), kanban-board.tsx IterationGoalBar (Escape+Enter), board-list-view.tsx IterationGoalInput (Escape+Enter) and the divider note-label input (Escape; its Enter path is native <form onSubmit>, which browsers already suppress during IME composition, so no handler change needed there), free-board.tsx ColumnNameEditor (Escape+Enter) and the new-column name input (Escape). story-detail-panel.tsx's original guard now calls the shared helper too instead of inlining the same check.

Tests: lib/utils/keyboard.test.ts (unit), plus one composition-simulating test added to quick-add-composer.test.tsx and kanban-board.test.tsx (IterationGoalBar) per AC #2's "at least the composer and one goal editor". All via fireEvent.keyDown(el, { key, isComposing: true }), the convention already used by story-detail-panel.test.tsx. 74/74 relevant tests pass; tsc --noEmit and eslint clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shared isImeComposing helper applied to every Escape/Enter inline-editor handler missing it (quick-add-composer, IterationGoalBar, IterationGoalInput, note input, free-board column editors). Verified via unit test + composition-simulating tests in quick-add-composer.test.tsx and kanban-board.test.tsx + tsc + eslint + fable-advisor review (no findings against this task). Owner deferred manual browser/IME verification to a bulk pre-deploy review pass (2026-07-17) — not blocking completion.
<!-- SECTION:FINAL_SUMMARY:END -->
