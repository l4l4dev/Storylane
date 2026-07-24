---
id: TASK-169
title: CommentThread test flakes on a pending-state race
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-23 04:01'
updated_date: '2026-07-23 05:13'
labels: []
milestone: m-2
dependencies: []
priority: medium
type: bug
ordinal: 1250
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex review (2026-07-23) found apps/web/components/features/story/comment-thread.test.tsx:69 asserts the pending comment state clears without properly waiting for it to resolve, causing intermittent failures under load/timing variance.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The test waits for the pending state to resolve via waitFor/findBy queries instead of assuming synchronous resolution
- [x] #2 The test passes consistently across repeated local runs (e.g. vitest run --repeat=10 or equivalent) with no flakes
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
comment-thread.test.tsx's "shows a failed submit result inline and keeps
the typed draft" test asserted the submit button was re-enabled right
after `await screen.findByRole("alert")` resolved -- but the alert (from
setError) and the transition's isPending flag flipping back to false
aren't guaranteed to land in the same render tick, so the button could
still read disabled at that exact point under timing/load variance.

Added a `waitFor(() => expect(...).toBeEnabled())` after the existing
findByRole assertions instead of asserting immediately.

Verified: 15 consecutive isolated runs of the file all passed (it wasn't
reliably flaky in isolation to begin with -- Codex's review and the
earlier failure both saw it fail only under full-suite worker load), plus
5 consecutive full `pnpm test` runs (703 passed each time, no flakes).
pnpm run lint and tsc --noEmit also clean.
<!-- SECTION:FINAL_SUMMARY:END -->
