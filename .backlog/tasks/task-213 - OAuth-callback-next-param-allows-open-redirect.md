---
id: TASK-213
title: OAuth callback next param allows open redirect
status: In Progress
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-27 06:09'
updated_date: '2026-07-30 20:01'
labels: []
milestone: m-2
dependencies: []
references:
  - apps/web/app/auth/callback/route.ts
priority: medium
type: bug
ordinal: 1325
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
auth/callback/route.ts reads next from the query string and redirects to ${origin}${next} with no validation that next is a same-origin relative path. A crafted next value (e.g. an absolute URL or userinfo-style host) can send a just-authenticated session to an attacker-controlled page. No caller currently sends a custom next, so the deep-link feature this supports isn't in active use. Found via Codex external review, 2026-07-27.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 next is rejected (falls back to /my-work) unless it is a same-origin relative path starting with a single /
- [x] #2 The default no-next redirect to /my-work is unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
apps/web/app/auth/callback/route.ts: validate next against /^\/(?!\/|\\)/ — a single leading slash not followed by another slash or a backslash. //host and /\host are both browser-normalized to a protocol-relative URL (same as an absolute URL), which is the open-redirect vector; anything not starting with / at all (absolute URLs, javascript:, etc.) is already excluded by requiring the leading /. An empty or missing next both fail the test (empty string is falsy) and fall back to /my-work, same as today.

New apps/web/app/auth/callback/route.test.ts (first test for this route): no-next default, safe same-origin next, three unsafe next shapes (absolute URL, protocol-relative, backslash), and the existing error-path redirect to /auth/login.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC evidence:
#1 route.test.ts's three unsafe-next cases (absolute URL, //host, /\host) all assert the fallback to /my-work.
#2 route.test.ts's no-next case asserts the unchanged /my-work redirect; the safe-next case asserts a same-origin next still passes through untouched.

Verification: SUPABASE_INTEGRATION=1 pnpm test = 1248 passed / 142 files (+6 from this task's new test file). pnpm run lint and tsc --noEmit clean.
<!-- SECTION:NOTES:END -->
