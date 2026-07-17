---
id: TASK-78
title: Convert throw-based server actions to a result-object pattern
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-17 14:08'
labels:
  - web
  - ux
dependencies: []
priority: medium
type: enhancement
ordinal: 1250
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
fable-advisor review of the TASK-72-75 UI batch (2026-07-17) flagged that in production, Next.js Server Actions replace a thrown Error's message with a generic message + digest -- so the try/catch pattern TASK-74 introduced (transition-buttons.tsx, task-checklist.tsx, comment-thread.tsx) only surfaces the real failure reason in dev, not prod. Users would see a generic error instead of e.g. "Story already delivered" or "Move the stories off this status before deleting it".

deleteEpic (apps/web/app/projects/[id]/epics/actions.ts, TASK-72) already avoids this: it catches internally and returns { ok: true } | { ok: false, message: string } instead of throwing, so its caller (epic-delete-menu.tsx) gets the real message regardless of environment. That's the pattern to extend.

Scope: audit apps/web/app/projects/[id]/board/actions.ts and apps/web/app/stories/[id]/actions.ts for throw-on-failure server actions whose callers already catch (transitionStory, estimateStory, addTask, toggleTask, deleteTask, addComment -- the TASK-74 set -- plus the pre-existing free-board.tsx / quick-add-composer.tsx mutations: setStatusWipLimit, createCustomStatus, updateCustomStatus, deleteCustomStatus, dropStoryFree, quickCreateStory/quickCreateStoryFree). Convert each to the result-object return shape and update its caller to check .ok instead of try/catch. deleteStory (redirects on success) is out of scope -- a redirect can't return a result object the same way; leave as-is unless a cleaner pattern is found.

Not a deploy blocker for TASK-3, but should land before it since it's exactly the failure path a first production deploy would exercise.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All throw-based server actions called from TASK-74/free-board/quick-add components return a discriminated result object instead of throwing
- [ ] #2 Callers check .ok and surface .message inline, matching the deleteEpic/epic-delete-menu.tsx pattern
- [ ] #3 A production-mode check (or a test asserting the message survives Next.js's digest-masking behavior) confirms the real failure text still reaches the UI
<!-- AC:END -->
