---
id: TASK-266
title: Fill small test gaps left by the Tracker step-1b reviews
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-17 08:46'
labels: []
milestone: m-10
dependencies:
  - TASK-256
priority: low
type: task
ordinal: 800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Behaviour already correct per the TASK-256 reviews; these tests only pin it. (1) DELETE .../stories/:storyId/follow is idempotent. (2) Removing a member drops their story owner and follower rows as seen through readStory. (3) Deleting a story cascades its owner and follower rows. (4) A blocker whose #n names its own story stores blocking_story_id null. (5) Accepting a story a second time after reopening resolves only blockers re-opened in between. (6) Under manual planning an unstarted backlog story sent {group: 'current'} with no neighbour lands on the Current seam (order [planned, u2, u1]). (7) A task on another project's story answers 404 through the route. (8) POST /labels with 'Foo ' then 'foo' yields one label.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each of the eight cases has a test that fails if the behaviour regresses
- [ ] #2 bun test, lint and typecheck in apps/server are green
<!-- AC:END -->
