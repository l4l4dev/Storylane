---
id: TASK-158
title: 'My Work: replace dead-end error copy with distinguishable messages'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 13:40'
updated_date: '2026-07-23 01:18'
labels: []
milestone: m-5
dependencies: []
references:
  - >-
    .backlog/docs/reviews/doc-17 -
    17-—-UX-panel-review-2026-07-22-—-My-Work-screen-10-expert-ux-review.md
priority: low
type: bug
ordinal: 820
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From doc-17 Low finding #37. Error banners on the My Work screen show generic dead-end copy ('Failed to save') or render raw server strings verbatim, giving the user no way to tell what actually went wrong or what to do next. Map error cases to distinguishable, actionable user-facing messages, following the project convention of distinguishing error causes rather than showing one generic message.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Column-manager and My Work error banners show distinguishable, actionable messages instead of a generic 'Failed to save' or a raw server string
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Applied the existing writeErrorMessage helper (lib/utils/write-error.ts, already used in settings/actions.ts) across every raw error.message passthrough in my-work/actions.ts (persistMark -- the most-hit path, every drag routes through it -- carryOverToday, dismissCarryOver, reorderMyWorkToday, reorderMyWorkColumn, createMyWorkColumn, and the set_story_state RPC call) instead of hand-rolling new translation logic: an RLS refusal (code 42501) now shows a context-specific, actionable message ("You no longer have access to this story's project -- refresh the page.", "Couldn't save the new order -- refresh the page and try again.", etc.); any other error code still surfaces its own message, which is usually already the actionable one (a constraint name, a bad value) per the helper's own documented reasoning. Also reworded my-work-column-manager.tsx's ColumnNameField fallbackError from the bare "Failed to save" (the literal phrase doc-17 #37 called out) to "Couldn't save the new name." -- this fallback only fires when a thrown value isn't even an Error instance, so it's rarely hit, but it's still one concrete improvement over the generic phrase. No design review this pass (fable-advisor/opus quota rate-limited) -- skipped as reasonable given this is copy/message-routing only, reusing an already-approved project pattern rather than introducing new UI. Tests: +3 (RLS-refusal translation via persistMark/createMyWorkColumn, and confirming a non-RLS error keeps its own message); full suite 687 pass; tsc/eslint clean. No DB/migration changes.
<!-- SECTION:FINAL_SUMMARY:END -->
