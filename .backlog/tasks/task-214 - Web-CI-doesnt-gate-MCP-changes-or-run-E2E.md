---
id: TASK-214
title: Web CI doesn't gate MCP changes or run E2E
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-27 06:09'
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
- [ ] #1 apps/mcp/** changes trigger the CI workflow
- [ ] #2 MCP integration tests run as part of CI (not just locally with SUPABASE_INTEGRATION=1 by hand)
- [ ] #3 Edge Function tests run as part of CI
- [ ] #4 Any existing E2E post-login assertion is updated to /my-work
<!-- AC:END -->
