---
id: TASK-121
title: Promote-to-Epic dialog shows stale error on reopen
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 11:00'
updated_date: '2026-07-22 07:38'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 11800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 finding #13. apps/web/components/features/story/story-peek-menu.tsx:144 (PromoteToEpicDialog)'s error/pending state isn't reset when reopened, unlike the sibling MoveCopyDialog which clears its error in an open-keyed effect.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 PromoteToEpicDialog resets its error/pending state when reopened, matching MoveCopyDialog's open-keyed reset effect
- [x] #2 A test proves reopening after a failed attempt shows a clean dialog, not the previous error
- [x] #3 pnpm test + lint green
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-sonnet-5
created: 2026-07-22 07:23
---
Reassigned from @claude-haiku-4-5 to @claude-sonnet-5 per owner instruction (2026-07-22).
---

created: 2026-07-22 07:38
---
Implemented with React's render-time "adjusting state when a prop changes" pattern (comparing open against a wasOpen state var during render) instead of MoveCopyDialog's useEffect, because a plain useEffect calling setError/setPending directly triggers the react-hooks/set-state-in-effect lint rule here. fable-advisor reviewed and approved (agent ade1bb7be22a7a48a): confirmed the pattern is correct per React's own docs, no StrictMode/concurrent-rendering issues, and DeleteStoryDialog has no local error/pending state so it can't have this class of bug (out of scope, no action needed).
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed by resetting error/pending state on reopen via React's render-time "adjusting state when a prop changes" pattern (wasOpen comparison), avoiding the react-hooks/set-state-in-effect lint violation a plain useEffect would trigger. Added a regression test verifying a failed promote attempt's error doesn't persist on reopen. fable-advisor reviewed and approved with no required changes.
<!-- SECTION:FINAL_SUMMARY:END -->
