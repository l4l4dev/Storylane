---
id: TASK-213
title: OAuth callback next param allows open redirect
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-27 06:09'
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
- [ ] #1 next is rejected (falls back to /my-work) unless it is a same-origin relative path starting with a single /
- [ ] #2 The default no-next redirect to /my-work is unchanged
<!-- AC:END -->
