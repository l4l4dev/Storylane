---
id: TASK-227
title: E2E suite is never run by CI
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-08-03 02:44'
labels: []
milestone: m-1
dependencies: []
references:
  - apps/web/e2e/core-flow.spec.ts
  - apps/web/playwright.config.ts
  - .github/workflows/web-ci.yml
priority: medium
ordinal: 1360
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
apps/web/e2e/core-flow.spec.ts covers the whole tracker loop — sign in, create a project, add and estimate a story, advance it to accepted, roll the iteration over — but nothing runs it automatically. playwright.config.ts calls itself a "Local-only E2E config" and web-ci.yml has no Playwright step, so the only thing standing between a broken core flow and main is someone remembering to run it by hand.

TASK-214 fixed the assertion that had already rotted while nobody was running it (it still expected a post-login redirect to /dashboard long after the app moved to /my-work). That is the shape of the problem: an unrun suite decays silently, and the longer it is unrun the more it costs to bring back.

Running it in CI is more than a step: it needs the app built or served, a live Supabase stack (the helpers in e2e/helpers/admin-client.ts talk to it directly with the service role key), and a Playwright browser install. The web-ci job already starts Supabase for the integration tests, so the stack is there — what is missing is the server, the browser, and a decision about whether this gates every PR or runs on a narrower trigger given the runtime cost.

Decide the trigger before implementing: gating every PR is the strongest signal but adds minutes to every push; a nightly or label-triggered run keeps PR feedback fast but lets a break sit until the next scheduled run.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A decision is recorded on when the E2E suite runs (every PR vs nightly/label-triggered), with the cost that choice accepts
- [ ] #2 The E2E suite runs automatically on that trigger and fails the job when the core flow breaks
- [ ] #3 A deliberately broken core flow is shown to fail the run, so the job is not passing vacuously
- [ ] #4 playwright.config.ts no longer describes itself as local-only if it is no longer local-only
<!-- AC:END -->
