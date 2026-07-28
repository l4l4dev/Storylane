---
id: TASK-196
title: >-
  Story detail: promote an existing story to an epic (set_epic_pinned has no UI
  caller)
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-25 08:16'
updated_date: '2026-07-26 09:02'
labels:
  - web
milestone: m-6
dependencies:
  - TASK-189
ordinal: 1775
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-20 §2 describes two entry points for becoming an epic: '+ Add Epic' (create_epic, a brand-new childless container — built in TASK-190) and 'the make this existing story an epic path for an existing story' (set_epic_pinned(story_id, true), built and fully tested in TASK-189 with its own RPC-level guards: owner/member only, rejects a personal project, rejects nesting an epic under an epic). TASK-191's /code-review found that second path has zero callers anywhere in apps/web outside its own integration test -- a user with an already-created, possibly-estimated, possibly-scheduled story that turns out to be epic-sized has no way to convert it in the product today.

Add a 'Turn into epic' action (story detail's overflow/'...' menu is the natural place, matching how the old split-story action was surfaced pre-doc-18) that calls set_epic_pinned(storyId, true) for a childless, non-container story. Per TASK-189's implementation notes, the RPC itself already clears points/state_id/iteration_id and logs the prior points to activity_logs when it flips epic_pinned true -- the UI only needs to call it and reflect the result (the story becomes a container, off the board, showing up in the Epics band/(/epics with TASK-193).

Unpinning (set_epic_pinned(storyId, false), reverting an epic back to a plain story) already has no UI caller either -- decide at implementation time whether this task also covers the reverse action or whether a childless-epic-with-no-real-use-for-it is rare enough to defer; the RPC already rejects unpinning while children remain, so the reverse action is only meaningful for an empty epic someone created by mistake.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A childless, non-container story's detail view offers a 'Turn into epic' action
- [x] #2 The action calls set_epic_pinned(storyId, true) and the story detail reflects the result (now a container: off the board, points/state/iteration cleared, visible in the Epics band)
- [x] #3 The action is hidden/disabled with an explained reason (not a dead control, ux-principles principle 1) for a story that already has children, is itself a container, or the viewer lacks owner/member role
- [x] #4 fable-advisor design review against spec/ux-principles.md before manual verification
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added 'Turn into epic...' to the story detail overflow menu (story-peek-menu.tsx), calling a new turnIntoEpic server action (set_epic_pinned RPC). canBecomeEpic hides the item for containers, children (parentId!==null), personal-project stories, and non-owner/member viewers (viewerIsMember added to StoryDetail). Confirmation dialog mirrors story-parent-picker.tsx's 'Make an epic?' copy. Unpinning (reverse direction) deferred per task text -- rare case, no UI need identified. fable-advisor design review (ux-principles) ran: found personal-project guard missing, fixed. /code-review (background, 8 finder angles) ran: found parentId/child-story guard missing, fixed; other 9 findings were pre-existing issues outside this task's changed files, filed as separate tasks per owner request.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Turn into epic action added to story detail overflow menu, calling set_epic_pinned via a new turnIntoEpic server action. Verified via vitest (16 tests in story-peek-menu.test.tsx covering visibility gating for container/child/personal-project/non-member cases and the confirm-and-call flow), tsc --noEmit, and eslint, all clean. Manual browser verification left to the owner (steps provided in chat).
<!-- SECTION:FINAL_SUMMARY:END -->
