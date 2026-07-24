---
id: TASK-191
title: 'List: two-line story rows + epic colour rule'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-24 18:15'
labels:
  - web
milestone: m-6
dependencies: []
documentation:
  - doc-20
type: enhancement
ordinal: 1750
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-20 §4. The single-line List row already overflows (type icon, number, title, state, points, epic, labels, assignee, transition buttons) and the epic chip is rendered `hidden sm:inline`, so epic membership is the first thing to disappear at narrow widths.

Give the row a second line and mark epic members with a left vertical rule in the epic's colour, so a run of siblings reads as one group while scrolling.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Story rows render on two lines: line 1 = type icon / #number / title / transition buttons, line 2 = epic name / state badge / points / labels / assignee
- [ ] #2 A story that belongs to an epic shows a left vertical rule in its epic_color; a story with no epic shows no rule
- [ ] #3 The epic name is never hidden by viewport width (the hidden sm:inline treatment is gone)
- [ ] #4 fable-advisor design review against spec/ux-principles.md before manual verification
<!-- AC:END -->
