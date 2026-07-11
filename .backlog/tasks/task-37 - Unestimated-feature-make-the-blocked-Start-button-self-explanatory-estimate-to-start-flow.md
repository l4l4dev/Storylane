---
id: TASK-37
title: >-
  Unestimated feature: make the blocked Start button self-explanatory
  (estimate-to-start flow)
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-11 05:18'
updated_date: '2026-07-11 06:36'
labels:
  - web
  - ux
dependencies: []
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11: adding a feature story to the current iteration shows a warning triangle and a disabled Start button with no explanation of what to do — user is stuck. Root cause: spec/features.md forbids starting an unestimated feature; apps/web/components/features/story/transition-buttons.tsx renders Start disabled with only a hover title.

DECIDED (owner, 2026-07-11): implement Pivotal Tracker's original pattern (two-step, no auto-start). Wherever the action buttons render (story detail, list row, card), an unestimated feature shows the project's point-scale buttons (e.g. 0 1 2 3 5 8 13) in place of Start — no disabled button, no warning triangle. Clicking a point estimates the story; the buttons are then replaced by the normal Start button, which the user clicks as a second step. Estimating never auto-starts the story (estimating from the backlog must not start work). Bugs/chores are unaffected (not estimateable, Start as today).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An unestimated feature shows point-scale estimation buttons in place of Start (no disabled Start, no hover-only hint) wherever transition buttons render
- [ ] #2 Clicking a point estimates the story and reveals the Start button; the story is NOT auto-started
- [ ] #3 Bug/chore stories keep their current immediate Start behavior
- [ ] #4 Tests cover estimate-then-start and no-auto-start
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified against Pivotal Tracker's official help (story_states, archived 2024): 'Story state action buttons will not appear on estimateable stories that have yet to be estimated - estimation buttons will appear instead.' Tracker never showed a disabled Start button — the collapsed story card showed the point-scale buttons (0/1/2/3...) in the Start button's place; one click estimated the story and the Start button then appeared. Implement that exact pattern: replace the disabled Start + warning triangle with inline estimation buttons (project point scale) on card/row/detail; after estimating, show Start. Note Tracker did NOT auto-start after estimating — estimate first, Start appears as a second click (keep two steps for parity, or offer estimate+start in one popover; confirm with the owner).

Follow spec/ux-principles.md (landed with TASK-46), especially principle 1 (no dead controls) — this task is its defining example. End with a fable-advisor design review before manual verification.
<!-- SECTION:NOTES:END -->
