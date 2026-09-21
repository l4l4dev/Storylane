---
id: TASK-263
title: Consolidate duplicated route validators and service helpers
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-17 08:46'
labels: []
milestone: m-10
dependencies:
  - TASK-256
priority: medium
type: task
ordinal: 650
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the TASK-256 final whole-branch review. The body parser and rejectUnknownKeys are copied into every project route file (projects, stories, story-parts, labels, iterations, invites); optionalNullableString exists twice; actorUserId is defined in routes/stories.ts, services/blockers.ts and services/comments.ts; storyNumber in services/reviews.ts, labels.ts and story-people.ts; isForeignKeyViolation lives in services/story-people.ts but reviews.ts imports it; sameIds duplicates an inline comparison in attachLabel; validateStoryInput and validateStoryPatch in routes/stories.ts are near-duplicates. Move route validation helpers into one routes/validate.ts and the shared service helpers into one module (the FK helper belongs next to the db layer). Behaviour-preserving refactor only. routes/auth.ts and routes/setup.ts keep their own lenient JSON parsing unless the owner decides otherwise.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each helper has exactly one definition and every former copy imports it
- [ ] #2 No response status or error code changes; the full apps/server suite passes unchanged
- [ ] #3 bun test, lint and typecheck in apps/server are green
<!-- AC:END -->
