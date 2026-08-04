---
id: TASK-213
title: OAuth callback next param allows open redirect
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-27 06:09'
updated_date: '2026-07-31 11:32'
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

Codex review of PR #17, round 1: P3 (stale comment, fixed), reacted to and replied.

Codex review of PR #17, round 2: one P3, accepted — and it corrected a factual error in my own security reasoning, not just a stale comment.

The original comment claimed //host and /\host next values are dangerous because browsers normalize them to protocol-relative URLs. Verified with node's URL parser that this is wrong for THIS code's concatenation pattern: origin + next with origin already a full absolute URL (https://storylane.example, no trailing slash) never lets a later // or /\ in the string reinterpret as a new authority — new URL('https://storylane.example//evil.example').origin is still https://storylane.example. The actual vector is a next with NO leading slash at all: '@evil.example/x' concatenated onto origin produces 'https://storylane.example@evil.example/x', which parses with evil.example as the host and storylane.example discarded as ignored userinfo — confirmed the same way. A single leading '/' closes this because it unambiguously starts the path; even '/@evil.example' cannot smuggle a new authority (verified).

The fix (require a leading '/') was already correct and already blocked '@evil.example' (it doesn't start with '/'), so no code change was needed — only the comment, which was rewritten to describe the userinfo vector, and the test suite, where the 'absolute URL' and 'protocol-relative' cases were replaced/relabeled: added a case for the actual exploit (@evil.example/phish) and a plain no-leading-slash case, and kept the //-prefixed and backslash-prefixed cases but noted in a comment that they are rejected because the AC requires a single leading '/', not because they are exploitable in this concatenation context.

Re-verified: SUPABASE_INTEGRATION=1 pnpm test = 1249 passed / 142 files, lint and tsc clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
auth/callback/route.ts's next param is now validated: it must start with a single leading / (a same-origin relative path) or the redirect falls back to /my-work, matching the existing no-next default. The real vulnerability the original next=<anything> concatenation onto ${origin} exposed is a userinfo-injection open redirect — a next with no leading slash, e.g. @evil.example/x, turns the redirect into https://storylane.example@evil.example/x, which browsers parse with evil.example as the host and storylane.example discarded as ignored userinfo. Requiring a leading / closes this unconditionally: once a / starts the string, nothing after it can reintroduce a new authority (verified directly with node's URL parser, both for the exploit and for the leading-/ case).

An earlier version of this fix's comment and tests cited a different, incorrect mechanism (browser normalization of // or /\ to a protocol-relative URL) — Codex's second review round caught that this doesn't actually apply to this code's origin + next string concatenation (verified: neither shape changes the parsed origin here). The validation itself needed no change since it already rejected the real vector; only the explanation and regression tests were corrected to describe what's actually being blocked.

Verified: SUPABASE_INTEGRATION=1 pnpm test = 1249 passed / 142 files, lint and tsc clean. Reviews: Codex round 1 (stale comment, fixed), round 2 (incorrect threat-model explanation, fixed), round 3 clean. Owner hit the Codex usage limit before a 4th round could run; merged on CI green + 3 clean/resolved Codex rounds as 050dff3.
<!-- SECTION:FINAL_SUMMARY:END -->
