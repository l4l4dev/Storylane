---
id: TASK-155
title: >-
  My Work: Done log reads as history (dedup marker, visible date, dated archive
  beyond cutoff)
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 13:39'
labels: []
dependencies: []
references:
  - >-
    .backlog/docs/reviews/doc-17 -
    17-—-UX-panel-review-2026-07-22-—-My-Work-screen-10-expert-ux-review.md
priority: medium
type: feature
ordinal: 760
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From doc-17 Medium findings #12 and #14, expanded per owner direction 2026-07-22. #12: a story that is both live and completed currently renders in an active column and in Done, distinguished only by a subtle marker -- reads as a duplication bug. Owner decision: strengthen the marker toward Norman/Krug's direction (make it read as history), not Ive's removal direction. #14: Done is dressed as a peer draggable column (same shell, grip, count) but is actually an append-only, time-boxed log -- differentiate its chrome so that nature is visible. Owner additionally asked for: the completion date to be visibly shown on each Done entry (currently only in a hover title per doc-17 #41, not visible at rest); the log's cutoff window to be a configurable setting instead of the current hardcoded 7 days; and a dated archive list where entries older than the cutoff can still be viewed (rather than just disappearing from Done). Keep the archive view read-only and simple -- if it needs a new DB column/table beyond what story_completions already provides, keep the migration minimal (existing RLS already covers story_completions).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A completed story that still shows elsewhere reads distinctly as history (not a duplicate/bug), per the owner-chosen strengthen direction
- [ ] #2 Done's chrome (no grip, distinct shell) visibly signals it is an append-only log, not a peer draggable column
- [ ] #3 Each Done entry shows its completion date visibly in the row (not only in a hover tooltip)
- [ ] #4 The archive cutoff (currently fixed at 7 days) is configurable via settings
- [ ] #5 A dated archive list lets the user see entries older than the cutoff
<!-- AC:END -->
