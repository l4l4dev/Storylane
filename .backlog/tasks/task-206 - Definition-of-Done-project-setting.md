---
id: TASK-206
title: Definition of Done project setting
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-27 01:48'
labels: []
milestone: m-0
dependencies: []
priority: low
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Storylane has no explicit Definition of Done concept — a done-category project_state (spec/data-model.md, spec/glossary.md 'Category') implicitly stands in for it, but teams have no place to write down what 'done' actually requires (tests written, reviewed, deployed, etc.). Add a per-project free-text DoD field, shown as a reference checklist when a story is moved into a done-category state, so the team's own bar for done is visible at the moment it matters instead of living only in a wiki or people's heads.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 projects table gains a definition_of_done text column, nullable, editable in Project Settings (spec/screens.md 'Project Settings') by owner/member
- [ ] #2 When a story is dragged/advanced into a done-category state (Kanban drag or the advance-to-next-state button, spec/features.md 'Transitions'), the DoD text is shown alongside the action (e.g. a tooltip/popover) as a reference — informational only, not a blocking gate
- [ ] #3 Empty DoD (default) shows nothing extra — no empty checklist UI
- [ ] #4 spec/data-model.md and spec/screens.md are updated to document the field and its display point
- [ ] #5 Tests cover the settings field's RLS/role restrictions
<!-- AC:END -->
