---
id: TASK-212
title: createDraftStory leaves partial rows on mid-flow failure
status: To Do
assignee:
  - '@claude-opus-5'
created_date: '2026-07-27 06:08'
labels: []
milestone: m-2
dependencies: []
references:
  - 'apps/web/app/projects/[id]/board/actions.ts'
priority: high
type: bug
ordinal: 1200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
createDraftStory (board/actions.ts) creates a story, positions it, and applies its remaining fields as separate, non-transactional steps (deliberate trade-off per its own comment, reusing insert_board_item/move_story_board/updateStory rather than a new RPC). If a later step fails, a title-only story is left behind, and the position-move error path is currently ignored. A retry then creates a duplicate instead of completing the original row. Found via Codex external review, 2026-07-27.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A failure in the position or field-update step for a new draft story does not leave an orphaned title-only row — either the whole creation rolls back or the caller can resume/complete the same row
- [ ] #2 The position-move error is surfaced to the caller instead of being silently ignored
- [ ] #3 All three creation paths (backlog, unstarted, icebox) keep working
<!-- AC:END -->
