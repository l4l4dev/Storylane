---
id: TASK-260
title: 'Tracker step 4: manual planning markers, team strength, velocity override'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-16 11:56'
labels: []
milestone: m-10
dependencies:
  - TASK-259
references:
  - docs/reference/tracker-notes/core-model.md
priority: medium
type: feature
ordinal: 600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design §3.3 step 4: completes planning behaviour — hand-placed iteration markers when automatic planning is off (the planned state), per-iteration team strength and length overrides in the UI, manual velocity override, and the time-boundary handling of derived iterations. Behaviour comes from the corpus (articles automatic_vs_manual_planning, team_strength, understanding_velocity); write the note before implementing. Ends with /code-review and the fable-advisor UI review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A planning note under docs/reference/tracker-notes/ records marker, team-strength and override behaviour with sources
- [ ] #2 Manual planning: stories dragged into Current become planned and the marker persists; switching automatic planning back on rewrites planned to unstarted first
- [ ] #3 Team strength and velocity override change the Current cut and velocity display as the note specifies
- [ ] #4 /code-review and fable-advisor UI review have no open findings
<!-- AC:END -->
