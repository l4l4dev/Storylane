---
id: TASK-129
title: >-
  Personal-task story detail: back-link goes to My Work, not the hidden
  project's Board
status: To Do
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-21 12:34'
labels: []
dependencies: []
priority: medium
type: enhancement
ordinal: 12600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-14 navigation fix (agreed early in the conversation, independent of the rest of doc-14's rework — can be done first). apps/web/app/stories/[id]/page.tsx:24 hardcodes href={`/projects/${detail.projectId}/board`} for the '← Board' link regardless of project type. For a personal-project (My Tasks) story, this is the only reachable path to that hidden project's full Board/Epics/Iterations/Activity/Settings nav, with no way back to it from the sidebar afterwards — confusing since that page was never meant to be a destination.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The story detail's back-link reads the story's project is_personal flag; when true, it links to /my-work instead of /projects/[id]/board
- [ ] #2 A non-personal-project story's back-link is unchanged (/projects/[id]/board)
- [ ] #3 The link label changes accordingly ('← My Work' vs '← Board')
- [ ] #4 A test covers both cases
- [ ] #5 pnpm test + lint green
<!-- AC:END -->
