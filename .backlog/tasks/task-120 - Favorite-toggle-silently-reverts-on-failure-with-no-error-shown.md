---
id: TASK-120
title: Favorite toggle silently reverts on failure with no error shown
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 11:00'
updated_date: '2026-07-22 07:27'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 11700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 finding #12. apps/web/components/features/projects/project-card-menu.tsx:43 reverts the optimistic favorite toggle on RPC failure with zero message, unlike the sibling pin toggle (story-peek-menu.tsx) which follows ux-principles.md principle 2 (a failed action must say so).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 project-card-menu.tsx's favorite toggle shows an inline error on RPC failure, matching the sibling pin-toggle's pattern
- [x] #2 A test proves a failed favorite toggle shows an error, not a silent revert
- [ ] #3 pnpm test + lint green
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-sonnet-5
created: 2026-07-22 07:16
---
Reassigned from @claude-haiku-4-5 to @claude-sonnet-5 per owner instruction (2026-07-22) — doing the haiku-queued bugs as part of this session's continuation.
---

author: @claude-sonnet-5
created: 2026-07-22 07:27
---
fable-advisor review: approved, no changes needed. Note: AC #1's 'sibling pin toggle' reference (story-peek-menu.tsx) was removed entirely in TASK-131 (pin removal) -- this fix instead follows the role="alert" pattern common to epic-form-dialog.tsx/epic-delete-menu.tsx/transition-buttons.tsx, which the advisor confirmed is the more accessible and currently-correct sibling to match.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
toggleFavorite (app/dashboard/actions.ts) now returns the shared ActionResult type, surfacing the RPC's error message on failure instead of a bare {ok:false}. project-card-menu.tsx tracks error state (role=alert, cleared on each new attempt/success), matching the epic-form-dialog.tsx/epic-delete-menu.tsx role=alert pattern (the AC's original 'sibling pin toggle' reference no longer exists post-TASK-131). Verified: 3 new/updated unit tests (visible error, clears on success, action-level message passthrough) + hands-on in browser (star toggle works, no layout regression). fable-advisor review: approved, no changes needed. tsc/lint green, full suite 603 passed.
<!-- SECTION:FINAL_SUMMARY:END -->
