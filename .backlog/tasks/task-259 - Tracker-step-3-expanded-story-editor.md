---
id: TASK-259
title: 'Tracker step 3: expanded story editor'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-16 11:55'
labels: []
milestone: m-10
dependencies:
  - TASK-258
references:
  - docs/reference/tracker-notes/project-view.md
  - docs/reference/tracker-notes/css-tokens.md
priority: medium
type: feature
ordinal: 500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design §3.3 step 3: the inline expanded story with every field, state transitions, tasks, comments and attachments, followers, blockers, reviews, story activity and #n links. Note gate: write docs/reference/tracker-notes/expanded-story.md first (articles + the recovered stylesheet, same method as project-view.md/css-tokens.md), then spec, then implement. Ends with the Playwright dimension test, /code-review and the fable-advisor UI review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 expanded-story.md note exists with behaviour rules (sourced) and a CSS-derived dimension table before implementation starts
- [ ] #2 Every field of the story resource is editable inline and every transition in the per-type table is reachable from the editor
- [ ] #3 Tasks, comments with attachments, followers, blockers, reviews and activity render and edit in place
- [ ] #4 Playwright dimension test passes; spec/screens.md updated; fable-advisor UI review has no open findings
<!-- AC:END -->
