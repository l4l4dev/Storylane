---
id: TASK-214
title: Web CI doesn't gate MCP changes or run E2E
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-27 06:09'
updated_date: '2026-08-03 02:44'
labels: []
milestone: m-1
dependencies: []
references:
  - .github/workflows/web-ci.yml
priority: medium
type: chore
ordinal: 1350
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web-ci.yml's path triggers list apps/web, packages, supabase, pnpm-lock.yaml, pnpm-workspace.yaml, and the workflow file itself — apps/mcp/** is not included, so MCP-only changes never trigger the CI job, and its integration tests, Edge Function tests, and any Playwright/E2E suite are not part of the standard gate at all. Existing E2E (if wired up elsewhere) also still expects a post-login redirect to /dashboard while the app redirects to /my-work. Found via Codex external review, 2026-07-27.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 apps/mcp/** changes trigger the CI workflow
- [x] #2 MCP integration tests run as part of CI (not just locally with SUPABASE_INTEGRATION=1 by hand)
- [x] #3 Edge Function tests run as part of CI
- [x] #4 Any existing E2E post-login assertion is updated to /my-work
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
web-ci.yml now triggers on apps/mcp/** and gates three things it never did: MCP type checking, the MCP test suite with SUPABASE_INTEGRATION=1 against the live stack the job already starts, and the Deno Edge Function tests. The MCP steps export SUPABASE_URL/SUPABASE_ANON_KEY rather than the NEXT_PUBLIC_ names, since the MCP server is not a Next app. Edge Function tests run before supabase start so a broken function fails in seconds instead of after the stack is up.

The E2E post-login assertion still expected /dashboard; the app has redirected to /my-work since the auth callback was rewritten. Fixed, and checked against apps/web/app/auth/callback/route.ts rather than assumed.

Verified by running every CI step locally: core/web/mcp type checks, web lint, 24 Deno tests, 29 MCP tests including the integration file, and the 901-test web suite. Two gaps found while doing it and filed rather than folded in: TASK-227 (the E2E suite is still never run automatically — this task only fixed its stale assertion) and TASK-228 (invite-search.integration.test.ts fails in a full local run because its own leftover users fill search_users_for_invite s 10-row cap; CI is unaffected only because its database starts empty).
<!-- SECTION:FINAL_SUMMARY:END -->
