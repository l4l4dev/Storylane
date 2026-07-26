---
id: TASK-198
title: 'Board: List view epic badge can silently drop for projects with many epics'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-26 09:03'
labels:
  - web
milestone: m-6
dependencies: []
ordinal: 1810
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by TASK-196's /code-review. story-list-row.tsx derives hasEpic from parentId !== null && parentEpicTitle !== null instead of trusting parentId alone -- this masks a real asymmetry between the two feeding queries in board/page.tsx: the containerRows query has no .range()/pagination while the stories query does (fetchAllRows). In a project with more epics than PostgREST's default row cap, containerById silently drops epics beyond the cap, parentEpicTitle comes back undefined for real children, and hasEpic goes false with no error -- the story quietly loses its epic badge instead of surfacing the data-fetch bug.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 board/page.tsx's containerRows query is paginated the same way the stories query is (fetchAllRows or equivalent), so it can't silently truncate in a project with many epics
- [ ] #2 A test (or reproduction) confirms a story's epic badge survives when the project has more epics than the default page cap
<!-- AC:END -->
