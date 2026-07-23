---
id: TASK-157
title: 'My Work: fix invalid role=button-wrapping-Link causing double tab stop'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 13:39'
updated_date: '2026-07-23 01:13'
labels: []
milestone: m-5
dependencies: []
references:
  - >-
    .backlog/docs/reviews/doc-17 -
    17-—-UX-panel-review-2026-07-22-—-My-Work-screen-10-expert-ux-review.md
priority: low
type: bug
ordinal: 800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From doc-17 Low finding #43. The draggable card wrapper applies dnd-kit's role="button" around the story's own <Link>, producing invalid ARIA nesting (a link inside a button role) and a double tab stop per card -- keyboard/screen-reader users tab through the same card twice.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each My Work card is a single tab stop with valid ARIA semantics (no button role wrapping a link)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Root-caused to the shared SortableItem component (apps/web/components/features/board/sortable-item.tsx), used by both My Work (MyWorkRow) and the board (StoryCard/StoryListRow) -- fixed once at the shared component per the project's root-cause convention rather than patching My Work's row alone. dnd-kit's useSortable() attributes (role=button, tabIndex, aria-roledescription) were spread onto the <li> wrapping each card's own <Link> to the story, producing invalid ARIA nesting (a link inside a button role) and two tab stops per card. Fix: only "listeners" (pointer/touch drag activation, works without focusability) is spread now; "attributes" is dropped entirely, leaving the card's own Link as the single, correctly-semantic tab stop. Traded off: keyboard-initiated CARD dragging (mouse/touch unaffected) -- noted as a ponytail: comment pointing at the established alternative (columns already solve this the 'right' way with a dedicated, separately-tabbable grip button; card reordering can get the same treatment later if a keyboard path is needed). No design review this pass (fable-advisor/opus quota rate-limited) -- skipped as reasonable given this is a pure accessibility/semantic fix with no visual change, on an already-established pattern (dedicated handle vs. whole-row interactive wrapping). Tests: +1 new sortable-item.test.tsx (asserts no role=button/tabindex on the wrapper, link remains focusable); full suite 684 pass (includes existing board tests using the same shared component, confirming no board regression); tsc/eslint clean. No DB/migration changes.
<!-- SECTION:FINAL_SUMMARY:END -->
