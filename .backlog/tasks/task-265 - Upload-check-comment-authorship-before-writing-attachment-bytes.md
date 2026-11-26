---
id: TASK-265
title: 'Upload: check comment authorship before writing attachment bytes'
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
ordinal: 750
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the TASK-256 final review (minor M4). POST /api/projects/:id/stories/:storyId/comments/:commentId/attachments authorizes the project before reading the body, but checks that the comment belongs to the story and that the actor is its author only inside the write transaction, after the bytes are on disk. A non-author member or a stale comment id costs up to 25 MiB of disk write followed by an unlink. Move the comment lookup and author check into the read-only pre-check (routes/story-parts.ts). This touches the upload path that went through an authz-reviewer pass, so run authz-reviewer again.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A non-author member's upload answers 403 not_comment_author with no bytes written, pinned by a test that checks the attachments directory
- [ ] #2 An unknown or other-story comment id answers 404 with no bytes written
- [ ] #3 authz-reviewer pass recorded in the task notes
- [ ] #4 bun test, lint and typecheck in apps/server are green
<!-- AC:END -->
