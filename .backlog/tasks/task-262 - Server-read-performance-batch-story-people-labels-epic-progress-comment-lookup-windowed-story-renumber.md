---
id: TASK-262
title: >-
  Server read performance: batch story people/labels, epic progress, comment
  lookup; windowed story renumber
status: To Do
assignee:
  - '@claude-opus-5'
created_date: '2026-09-17 08:46'
labels: []
milestone: m-10
dependencies:
  - TASK-256
priority: high
type: task
ordinal: 350
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the TASK-256 final whole-branch review; must land before the TASK-258 board reads the whole backlog. (1) services/stories.ts toRow runs three SELECTs per row (owner_ids, label_ids, follower_ids), so listStories over N stories is 3N+1 queries: batch with inArray and group in memory. (2) services/labels.ts listEpics computes epicProgress once per epic, and createEpic/updateEpic/moveEpic re-run the whole listEpics to return one row. (3) routes/story-parts.ts finds one comment by loading every comment on the story with attachments (commentOnStory(listComments(...))): load the row directly with loadInProject and check its story_id. (4) services/ordering.ts renumber rewrites the whole list inside the request transaction when a seam runs out; renumber a bounded window around the seam instead, keeping UNIQUE (project_id, list, position) safe (two-pass negative positions).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 listStories issues a constant number of queries regardless of story count, with a test that counts statements or asserts on a large seeded list
- [ ] #2 listEpics computes progress in one grouped query; epic writes return their row without recomputing every epic
- [ ] #3 comment PUT/DELETE/upload resolve the comment without listing the story's comments
- [ ] #4 a seam renumber touches only a bounded window of rows, and the ordering concurrency tests still pass
- [ ] #5 bun test, lint and typecheck in apps/server are green
<!-- AC:END -->
