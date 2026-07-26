---
id: TASK-197
title: 'Board: detach-from-epic action has no error handling'
status: Done
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-26 09:03'
updated_date: '2026-07-26 09:42'
labels:
  - web
milestone: m-6
dependencies: []
ordinal: 1800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by TASK-196's /code-review. story-epic-menu.tsx's detach() calls setStoryParent inside startTransition with no try/catch, unlike the sibling add-child-picker.tsx which was hardened for this exact case. setStoryParent (apps/web/app/projects/[id]/board/actions.ts) can throw (e.g. createClient() failing) rather than resolve to {ok:false}. When it does, the exception becomes an unhandled rejection inside startTransition -- the dropdown just closes, no error is shown, and the user believes the story was detached from its epic when it silently was not.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 detach() wraps its setStoryParent call in try/catch (or try/finally), matching add-child-picker.tsx's pattern
- [x] #2 A thrown error surfaces a visible message instead of failing silently
- [x] #3 A test covers setStoryParent rejecting outright, mirroring add-child-picker.test.tsx's equivalent case
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wrapped detach()'s setStoryParent call in try/catch (story-epic-menu.tsx), mirroring add-child-picker.tsx's hardening -- a thrown error now calls onError(message) instead of becoming an unhandled rejection inside startTransition. Added story-epic-menu.test.tsx (3 tests: success, RPC refusal, outright rejection). Verified via vitest (835 tests, full suite), tsc --noEmit, eslint, all clean.
<!-- SECTION:FINAL_SUMMARY:END -->
