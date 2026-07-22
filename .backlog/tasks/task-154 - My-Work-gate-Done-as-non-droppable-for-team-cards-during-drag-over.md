---
id: TASK-154
title: 'My Work: gate Done as non-droppable for team cards during drag-over'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 13:33'
updated_date: '2026-07-22 16:38'
labels: []
dependencies: []
references:
  - >-
    .backlog/docs/reviews/doc-17 -
    17-—-UX-panel-review-2026-07-22-—-My-Work-screen-10-expert-ux-review.md
priority: medium
type: bug
ordinal: 750
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From doc-17 High-impact finding #10. Done's dnd-kit drag-over predicate accepts every card unconditionally, so dragging a team story into Done animates/snaps as if accepted, then the server rejects the write and it snaps back -- a false affordance (Norman error-prevention core). Note: the underlying rule that a team story completes only on its own board is spec'd (screens.md:386-419) -- this task only changes what the drag-over UI allows, not the completion rule itself.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Dragging a team-story card over Done shows it as a non-droppable target during drag, so the card never visibly enters a place it cannot stay
- [x] #2 Personal-project cards are unaffected and can still complete via a Done drop
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a pure predicate canDropOnDone(isPersonal) in lib/utils/my-work.ts and wired it into handleDragOver's moveBetweenContainers isAllowed check -- Done now rejects a team card as a drag-over target during the hover itself (AC#1: it never visually enters), while personal cards are unaffected (AC#2, canDropOnDone(true) === true). fable-advisor (opus fallback) design review: approved with 1 required fix, applied -- added a comment on handleDragEnd's (deliberately ungated) setMyWorkColumn call explaining WHY it must stay ungated: spec/screens.md requires a team-to-Done drop be 'rejected with a visible message' (the dragError banner), so gating drag-END the same way drag-OVER is gated would silently turn that into a no-op instead, violating the spec. No explicit 'not-allowed' cursor/outline was recommended or added -- the drop-time banner already satisfies ux-principles' feedback requirement; hover-time silence for a non-viable target needs no extra cue. Tests: +2 (canDropOnDone unit tests); the review noted the deeper spec invariant (team-to-Done drop shows an error) still has no integration/component test -- a pre-existing gap, not introduced by this task, flagged but not required to close here given the codebase has no dnd-kit drag-simulation test infrastructure to build on. 671 full suite pass; tsc/eslint clean. No DB/migration changes.
<!-- SECTION:FINAL_SUMMARY:END -->
