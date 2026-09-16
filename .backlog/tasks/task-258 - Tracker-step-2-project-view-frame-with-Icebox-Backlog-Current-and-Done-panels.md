---
id: TASK-258
title: >-
  Tracker step 2: project view frame with Icebox, Backlog, Current and Done
  panels
status: To Do
assignee:
  - '@claude-opus-5'
created_date: '2026-09-16 11:55'
labels: []
milestone: m-10
dependencies:
  - TASK-257
references:
  - docs/reference/tracker-notes/project-view.md
  - docs/reference/tracker-notes/css-tokens.md
  - docs/design/2026-09-16-tracker-parity-rewrite-design.md
priority: high
type: feature
ordinal: 400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
First Tracker screen (design §3.3 step 2): the header, project bar, left sidebar with panel toggles, side-by-side scrollable panels, panel headers, the Icebox / Backlog / Current / Done panels with collapsed story rows, state buttons, drag within and between panels, Add story and quick estimate — Current derived by automatic planning. Pixel values come from the recovered Tracker stylesheet via docs/reference/tracker-notes/css-tokens.md (fonts, paddings, colours), behaviour from docs/reference/tracker-notes/project-view.md. Colours may differ from Tracker; layout and text density may not. Rewrite spec/screens.md for this screen in the same commit series; new apps/web is built fresh against tokens.css (never vendor the archived CSS). Ends with a Playwright dimension test, /code-review and the fable-advisor UI review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Sidebar toggles, panel frame and the four panels render with the css-tokens.md values (row box, panel header, iteration header, state buttons, sidebar widths)
- [ ] #2 Current is the head of the Current+Backlog list cut by the planning algorithm; Done lists past iterations by accepted_at
- [ ] #3 Drag within/between panels and Add story land where project-view.md says; state buttons follow the per-type transition table
- [ ] #4 Playwright test asserts the measured dimension table within 1 CSS px; spec/screens.md rewritten; fable-advisor UI review has no open findings
<!-- AC:END -->
