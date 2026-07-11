---
id: TASK-36
title: >-
  List view: per-group Add story composer (Trello-style) with explicit
  destination
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-11 05:17'
updated_date: '2026-07-11 06:36'
labels:
  - web
  - ux
dependencies: []
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11, two related complaints about the List view quick-add (apps/web/components/features/board/quick-add-composer.tsx, board-list-view.tsx):
1. Nothing is added until Enter is pressed, and the composer rows ('Iteration #1 - current - 0 pts Add story' / 'Backlog Add story') run together visually, so it is hard to tell what you are doing.
2. Add story only targets the Backlog; with future iterations present it is unclear where a new story will land.

Adopt the pattern common to Trello/Linear-style boards: each group (current iteration, each future iteration, Backlog, Icebox) gets its own '+ Add story' button at the BOTTOM of the group. Clicking opens an inline card composer scoped to that group with a visible 'Add' button (Enter also submits), Esc/blur cancels, and the composer stays open after submit for rapid consecutive entry. New stories append to the bottom of that group. The button must be visually separated from the group header line.

Design options were proposed to the owner (2026-07-11 review reply) — confirm chosen variant in the task before implementing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every List-view group has its own Add story affordance at the group's bottom edge
- [ ] #2 Composer shows an explicit Add button; Enter submits, Esc cancels, composer remains open after each add
- [ ] #3 A story added from a group lands in that group (correct iteration_id/backlog/icebox) at its bottom
- [ ] #4 Tests cover per-group destination and consecutive adds
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow spec/ux-principles.md (landed with TASK-46), especially principle 4 (create destination visible at point of action) and 7 (honest hit targets). Check original Tracker's adding_stories help via the Wayback procedure in that file. End with a fable-advisor design review before manual verification.
<!-- SECTION:NOTES:END -->
