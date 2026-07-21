---
id: TASK-118
title: Project-creation DB failure throws uncaught instead of showing inline error
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 11:00'
updated_date: '2026-07-21 13:57'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 11500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 finding #10. apps/web/components/features/projects/inline-create-panel.tsx:29 (handleCreate) awaits createProject with no try/catch; createProject (apps/web/app/dashboard/actions.ts) throws on a DB error instead of returning a value like every sibling action in this directory.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 createProject's DB-error path is caught in inline-create-panel.tsx and shown as an inline error, matching the return-value-not-throw pattern used by sibling actions in this directory
- [x] #2 A test proves a failed creation shows an inline error instead of propagating an uncaught exception
- [x] #3 pnpm test + lint green
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. apps/web/app/dashboard/actions.ts: change createProject's DB-insert error path from 'throw new Error(error.message)' to 'return { ok: false, message: error.message }', matching toggleFavorite's return-value-not-throw pattern in the same file. Return type becomes Promise<{ ok: false; message: string } | void> (the success path still ends in redirect(), which never returns). createProject's only real caller is inline-create-panel.tsx (confirmed via grep), so this doesn't need a compatibility shim anywhere else.
2. apps/web/components/features/projects/inline-create-panel.tsx: handleCreate now checks the returned result -- on { ok: false }, sets a local error state and shows it inline (matching invite-member-form.tsx's text-sm text-destructive convention) without closing the panel or clearing the invitee list, so the user can retry without losing their input. Deliberately did NOT wrap the call in try/catch -- createProject's success path calls next/navigation's redirect(), which relies on throwing a special internal signal that Next.js's action-response transport handles before it reaches the client as a rejected promise; the return-value approach sidesteps needing to special-case that signal in a catch block entirely.
3. Add a DB-error-path test to app/dashboard/actions.test.ts (extends the existing insert mock to support returning an error) and an inline-error test to inline-create-panel.test.tsx (submits the form, asserts the error text renders and the panel/Name field stays open for retry).
4. Run pnpm test + pnpm run lint.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fix: createProject (apps/web/app/dashboard/actions.ts) now returns { ok: false, message } on a DB insert error instead of throwing, matching toggleFavorite's existing pattern. inline-create-panel.tsx's handleCreate checks the result and shows the message inline via a local error state, without touching the redirect() success path (no try/catch needed since the return-value change avoids ever needing to distinguish a thrown DB error from redirect()'s internal throw). Verified: pnpm exec vitest run on both changed test files (9/9 pass), pnpm run lint clean, full pnpm test (562 passed, 186 pre-existing skips, 0 failed).

Review follow-up: reused the existing ActionResult type (lib/types.ts) for createProject's return type instead of an ad-hoc inline {ok:false,message} shape, and added a one-line comment in handleCreate explaining why the call isn't wrapped in try/catch (would risk swallowing redirect()'s internal throw). Re-verified: pnpm test (562 passed), pnpm run lint, pnpm exec tsc --noEmit, all clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Project-creation DB failures now surface as an inline error next to the form instead of an uncaught exception -- createProject returns { ok: false, message } like its toggleFavorite sibling, and inline-create-panel.tsx renders that message while keeping the panel open and the user's input intact for a retry. Verified via new tests in actions.test.ts and inline-create-panel.test.tsx plus full pnpm test (562 passed) and pnpm run lint (clean).
<!-- SECTION:FINAL_SUMMARY:END -->
