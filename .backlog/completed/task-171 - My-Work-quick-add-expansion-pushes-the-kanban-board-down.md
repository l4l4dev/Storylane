---
id: TASK-171
title: 'My Work: quick-add expansion pushes the kanban board down'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-23 06:41'
updated_date: '2026-07-23 06:57'
labels: []
milestone: m-2
dependencies: []
references:
  - apps/web/app/my-work/page.tsx
  - apps/web/components/features/my-work/my-work-quick-add.tsx
  - apps/web/components/features/board/draft-story-card.tsx
priority: medium
type: bug
ordinal: 1700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The header quick-add (MyWorkQuickAdd in apps/web/app/my-work/page.tsx:251-269) renders above and outside the whole My Work kanban board, in normal document flow. Clicking 'Add a personal task' expands the trigger into the full DraftStoryCard form, which pushes the entire board (all columns) down the page — a jarring shift the board-embedded drafts on the project board don't cause (those expand inside a single column). The owner wants opening quick-add to not shift the board at all; an overlay/popover presentation is explicitly acceptable.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Opening the personal-task quick-add on My Work does not move/shift the kanban board below it
- [x] #2 Closing quick-add (cancel or successful submit) returns to a stable layout with no residual shift
- [x] #3 Works at the same breakpoints the board already supports (360/768/1024px)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Restructure MyWorkQuickAdd (my-work-quick-add.tsx) to always render the DraftStoryTrigger button in normal flow, and when open, render DraftStoryCard as an absolutely-positioned overlay (w-72, matching the boards own column width per doc-17) anchored below the trigger inside a relative wrapper -- the card is then out of document flow, so the wrapping max-w-3xl block in page.tsx never grows and the board below never shifts.
2. No changes to DraftStoryCard itself or its other (board panel) callers -- they keep their existing inline/in-flow rendering, only My Work usage changes.
3. Add a light RTL test in my-work-quick-add.test.tsx asserting the open-state card container carries an out-of-flow (absolute) positioning class, to guard the fix intent (exact pixel/visual regression is not testable in jsdom).
4. Manually verify at 360/768/1024px per AC#3 (owner to confirm visually; note in final summary that automated coverage is layout-intent only).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Made MyWorkQuickAdd (my-work-quick-add.tsx) always render the trigger button in normal flow; the open DraftStoryCard now renders as an absolute overlay (w-72, mt-2, max-w-[calc(100vw-3rem)]) inside a relative wrapper instead of inline, so it no longer grows the block above the board. Verified with: (1) new RTL test my-work-quick-add.test.tsx asserting the open card sits in an .absolute container, (2) a throwaway Playwright script driving the real dev server at 360/768/1024px viewports confirming the Todo column header's y-position is unchanged before/after opening the quick-add and the overlay never overflows the viewport horizontally, screenshots saved to scratchpad. vitest (88 tests in my-work scope), tsc --noEmit, and eslint all pass.

fable-advisor design review (post-implementation, per CLAUDE.md UI-work rule): approved the overlay approach against spec/ux-principles.md principle 3 (no layout shift on conditional UI) and confirmed diverging from the board's own inline-in-column pattern is intentional, not an accidental parity break (My Work's + sits above 4 columns, not inside one panel). One correction applied: the overlay's z-20 collided with my-work-sections.tsx's sticky dragError banner (also z-20, same stacking context) — bumped to z-30 (popover tier, below story-peek's z-40) with a comment recording the tier. Re-ran vitest/tsc/eslint (all pass) and re-confirmed the overlay renders correctly in the browser after the change.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Reworked MyWorkQuickAdd to render its open DraftStoryCard as an absolute overlay instead of an inline block, so opening it no longer pushes the My Work kanban board down. Verified in a real browser (dev server) at 360/768/1024px: board position is unchanged and the overlay never overflows the viewport. RTL test added; vitest/tsc/eslint all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
