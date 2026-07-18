---
id: TASK-89
title: 'My Work: cross-project personal view, remove Focus view'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-18 03:05'
updated_date: '2026-07-18 03:20'
labels:
  - web
  - ux
dependencies:
  - TASK-84
  - TASK-88
  - TASK-91
priority: high
ordinal: 60000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-8 §9 UI. New cross-project view for the signed-in user: stories assigned to them across all projects; a 1-day projects current iteration is todays plan by definition; longer-cadence stories enter today via the personal pin (TASK-88). Personal-project (1-day) stories get a visual accent (e.g. color) distinguishing them from team-project stories. Remove the per-project Focus view (focus-board.tsx and toggle entry); board toggle becomes List/Kanban (interacts with TASK-77 item 6 view persistence — two views only). Screen details (buckets beyond today, ordering, pin gestures) get specced in this tasks plan phase against spec/screens.md and reviewed before implementation. Global quick-add shortcut decision (doc-8 §10) is made here.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 My Work shows assigned stories from all projects; today = 1-day current iteration + pinned stories; pin/unpin works from the view
- [ ] #2 Personal-project stories are visually distinguished
- [ ] #3 Focus view is gone; board toggle is List/Kanban only
- [ ] #4 fable-advisor design review against spec/ux-principles.md passes with findings triaged
- [ ] #5 pnpm test passes
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-18 03:20
---
Dep added (advisor 2nd pass): My Work renders story states cross-project; build against project_states (TASK-91), not the enum.
---
<!-- COMMENTS:END -->
