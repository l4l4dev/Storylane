---
id: TASK-199
title: '/epics page: parallelize the peek story fetch with the page''s own queries'
status: To Do
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-26 09:03'
labels:
  - web
milestone: m-6
dependencies: []
ordinal: 1820
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by TASK-196's /code-review. apps/web/app/projects/[id]/epics/page.tsx awaits getStoryDetail(peekStoryId) sequentially after the page's own Promise.all, even though peekStoryId has no dependency on that fetch. getStoryDetail internally batches ~11 Supabase queries via its own Promise.all -- running it after (rather than alongside) the epics page's 4-query Promise.all serializes two independent network round-trips, roughly doubling server-render latency on any /epics?story=<id> load.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 getStoryDetail(peekStoryId) (when present) is launched together with the page's existing Promise.all rather than awaited afterward
- [ ] #2 Behavior is unchanged when there is no peekStoryId
<!-- AC:END -->
