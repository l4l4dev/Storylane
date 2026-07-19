---
id: TASK-89
title: 'My Work: cross-project personal view, remove Focus view'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-18 03:05'
updated_date: '2026-07-19 06:29'
labels:
  - web
  - ux
milestone: m-5
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

created: 2026-07-18 05:48
---
Screen design decided by the owner 2026-07-18 (doc-8 §9, option A "Today-first single column") — implement this shape and write it into spec/screens.md as part of this task. Buckets top-to-bottom: Today (pinned stories + current-iteration stories of 1-day-cadence projects, personal accent color); Needs review (stories at the accept gate — in an in_progress-category state whose position-wise next state is done-category — where the signed-in user is the requester; Pivotal My Work parity, fetched from the archived mywork_panel help article); In progress (owned, in_progress category); Todo (owned, unstarted category, not pinned); Done (grouped under date headers by completed_at — deliberate divergence, Pivotal excluded accepted by default). Every card shows a small project-name chip. No reordering inside My Work (parity: it is a read view; priority lives on each project board). Accessed from the left sidebar.
---
<!-- COMMENTS:END -->
