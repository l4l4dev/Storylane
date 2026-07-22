---
id: TASK-154
title: 'My Work: gate Done as non-droppable for team cards during drag-over'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 13:33'
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
- [ ] #1 Dragging a team-story card over Done shows it as a non-droppable target during drag, so the card never visibly enters a place it cannot stay
- [ ] #2 Personal-project cards are unaffected and can still complete via a Done drop
<!-- AC:END -->
