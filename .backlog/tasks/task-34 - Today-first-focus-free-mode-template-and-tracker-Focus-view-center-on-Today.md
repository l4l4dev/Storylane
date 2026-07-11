---
id: TASK-34
title: 'Today-first focus: free-mode template and tracker Focus view center on Today'
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 05:17'
updated_date: '2026-07-11 06:37'
labels:
  - web
  - ux
  - design
dependencies: []
priority: medium
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11: both modes should focus on TODAY, not the week.

Free mode: the default template currently seeds Todo / This week / Today / In progress / Done (apps/web/app/dashboard/actions.ts FREE_TEMPLATE_STATUSES). Change the default seed to be today-centric (e.g. Todo / Today / In progress / Done); 'This week' must NOT be seeded by default — users add it themselves later as a custom column (depends on being able to add columns from the board, TASK for board-side column management).

Tracker mode: the Focus view (apps/web/components/features/board/focus-board.tsx) should likewise present 'what I do today' as its core framing, not the whole current iteration. Design needed: how 'today' is derived (started stories? explicit today flag? completed_at = today for done grouping). Spec update to spec/screens.md required before implementation.

Architecture-sensitive: touches template seeds, Focus view semantics, possibly a new story field — get /advisor review on the chosen design first.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 New free-mode projects seed a today-centric column set without 'This week'
- [ ] #2 'This week' can still be added manually as a normal custom column
- [ ] #3 Tracker Focus view visually centers on today's work with a clear definition of what appears there
- [ ] #4 spec/screens.md updated to describe the Today-first behavior for both modes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow spec/ux-principles.md (landed with TASK-46) — includes the Tracker-parity verification procedure (Wayback) for tracker-mode Focus. End with a fable-advisor design review against that file before manual verification.
<!-- SECTION:NOTES:END -->
