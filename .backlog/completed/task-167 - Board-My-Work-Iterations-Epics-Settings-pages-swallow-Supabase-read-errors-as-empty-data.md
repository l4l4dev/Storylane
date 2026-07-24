---
id: TASK-167
title: >-
  Board/My Work/Iterations/Epics/Settings pages swallow Supabase read errors as
  empty data
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-23 04:01'
updated_date: '2026-07-23 05:07'
labels: []
milestone: m-2
dependencies: []
priority: medium
type: bug
ordinal: 1150
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex review (2026-07-23) found several server-component pages destructure only 'data' from Supabase reads and discard 'error' — e.g. apps/web/app/projects/[id]/board/page.tsx:66. A transient DB outage therefore renders as a 404 (project not found) or an empty board/list instead of reaching the existing error.tsx boundary. The same pattern is present on My Work, Iterations, Epics, and Settings pages.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every top-level Supabase read across the Board, My Work, Iterations, Epics, and Settings pages throws when its 'error' is non-null instead of proceeding on 'data' alone
- [x] #2 A thrown read error reaches the route's error.tsx, verified by a test or a documented manual repro per page
- [x] #3 pnpm test and pnpm run lint are green from apps/web
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added assertReadOk() to apps/web/lib/supabase/assert.ts -- throws when a
Supabase read's `error` is set instead of the `const { data } = await
supabase...` pattern that discards it. Wired it into every top-level read
in the five flagged pages (Board, My Work, Iterations, Epics, both Project
Settings and the global Account Settings page) plus the shared
ensureCurrentIteration() helper (board/actions.ts) that Board and
Iterations both call before rendering.

Switched every existence-check read from `.single()` to `.maybeSingle()`
first: `.single()` itself errors on zero rows (PGRST116), which would have
made assertReadOk turn every ordinary "project not found" / "not a member"
case into a 500 instead of the existing 404 (notFound()). `.maybeSingle()`
resolves `{data: null, error: null}` on zero rows, so the 404 path is
unchanged and only a genuine read failure now throws.

Verified: assert.test.ts covers assertReadOk directly (pass-through,
null-on-not-found, throw-on-error). Added one test per page
(page.test.tsx x5) that mocks a failing Supabase read and asserts the
page's async function rejects instead of resolving -- proving the error
reaches Next's error boundary instead of rendering an empty/404 page (this
codebase had no prior page-level tests; each new test is scoped to the
single earliest read so no other module needed mocking). pnpm test (703
passed, up from 691), pnpm run lint, and pnpm run build all green from
apps/web. tsc --noEmit clean.
<!-- SECTION:FINAL_SUMMARY:END -->
