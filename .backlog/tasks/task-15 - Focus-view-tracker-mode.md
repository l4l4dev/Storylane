---
id: TASK-15
title: Focus view (tracker mode)
status: To Do
assignee: []
created_date: '2026-07-07 14:27'
updated_date: '2026-07-08 12:38'
labels:
  - web
  - db
dependencies: []
references:
  - spec/screens.md
  - spec/data-model.md
priority: high
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Third board view per spec/screens.md 'Focus view': Todo / This week / Today / In progress / Done over the current iteration's stories. Migration adds stories.focus ('today'|'this_week'|NULL) and stories.completed_at (set on accepted, cleared when leaving accepted — completed_at is also the free-mode done-date source, see spec/data-model.md). Dragging between Todo/This week/Today sets focus and never touches state; state changes use on-card transition buttons; Done is read-only, grouped by completed_at date headers.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Migration adds stories.focus and stories.completed_at; completed_at maintained on the tracker state-transition path (set on accepted, cleared on leaving); rls-security-reviewer has reviewed it
- [ ] #2 Focus appears in the view toggle (List / Kanban / Focus); columns render per spec
- [ ] #3 Drag between Todo / This week / Today sets or clears focus without state changes; In progress and Done are not drop targets
- [ ] #4 Done column groups accepted stories under Today / Yesterday / date headers by completed_at
- [ ] #5 Quick-add and side peek work in this view; focus survives rollover on carried-over stories
- [ ] #6 Tests cover focus bucketing, completed_at set/clear, and Done grouping
<!-- AC:END -->
