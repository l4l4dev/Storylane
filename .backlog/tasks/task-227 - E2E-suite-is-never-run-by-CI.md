---
id: TASK-227
title: E2E suite is never run by CI
status: Done
assignee:
  - '@claude-opus-5'
created_date: '2026-08-03 02:44'
updated_date: '2026-08-04 04:39'
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
- [x] #1 A decision is recorded on when the E2E suite runs (every PR vs nightly/label-triggered), with the cost that choice accepts
- [x] #2 The E2E suite runs automatically on that trigger and fails the job when the core flow breaks
- [x] #3 A deliberately broken core flow is shown to fail the run, so the job is not passing vacuously
- [x] #4 playwright.config.ts no longer describes itself as local-only if it is no longer local-only
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Fix the rotted spec so it can be gated at all — it fails on main today (verified 2026-08-04 before any change).
2. Wire Playwright into the existing web-ci job: browser install + a Run E2E step reusing the Supabase stack that job already starts.
3. Drop playwright.config.ts's local-only framing and raise the webServer timeout for a cold runner.
4. Prove the gate is not vacuous by breaking the core flow on the PR branch and watching CI go red, then reverting.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## AC#1 — trigger decision (owner, 2026-08-04): every PR

Runs as a step in the existing web-ci job rather than a separate workflow or a
schedule. That job already starts the Supabase stack and installs the
workspace, so the marginal cost is the Chromium download and the run itself —
roughly two minutes on top of a job that already takes several.

Accepted cost: every push to a PR pays those minutes. Rejected alternatives:
nightly (a break sits up to 24h, and by then it is already on main) and a
label-triggered run (reintroduces the 'someone has to remember' failure this
task exists to remove).

## The suite had already rotted again

Before touching CI, the suite was run locally: it failed twice, in two places
neither of which any other test covers.

- Project creation: My Work has no create form. The entry moved to the
  sidebar's project switcher, which links to /dashboard?new=1 (TASK-104).
- Quick-add: the single 'New story title' textbox plus Enter is now a draft
  card with the full field set and an explicit Save (TASK-82).

Both are exactly the decay the task describes. The spec now enters through the
real sidebar path, and sets points on the draft card instead of writing them
behind the UI's back — which retired the estimateStory helper entirely.

## next dev, not next start

The suite signs in with '/auth/login's Continue as dev user' button, which
renders under NODE_ENV !== 'production' and is the only way in without a real
OAuth provider. So CI runs the dev server, and the production build stays a
separate step. The seeded account comes from supabase/seed.sql, which
'supabase start' applies to the fresh CI stack.

## AC#3 — the gate is not vacuous (PR #24, 2026-08-04)

Demonstrated on the PR by dropping the ensureCurrentIteration call from the
board page (commit 545ce0f, reverted in 77a506c) — chosen because
board/page.test.tsx never asserts that call and the orphaned import is only an
eslint warning, so every other gate stayed green by construction.

Run 30877436863: 'Run E2E (web)' was the single failing step, on
'waiting for getByText("Ship the thing ...")' — no current iteration means no
Current panel to quick-add into. The playwright-traces artifact (1.9MB) uploaded
as intended, so a CI-only failure is debuggable without reproducing it locally.

## Measured cost

Install Playwright browser 29s + Run E2E (web) 29s = 58s added, against the
two minutes estimated when the trigger was chosen. The E2E step includes the
cold 'next dev' boot and first-route compile.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The E2E suite now runs on every pull request, as a step in the existing web-ci job that already starts the Supabase stack it needs.

It had rotted again before this could be wired up: run against main, it failed on project creation (the entry moved to the sidebar's switcher and /dashboard?new=1) and on quick-add (now a draft card with an explicit Save, not a title textbox plus Enter). The spec was brought back to the real UI and now sets points on the card, which retired the estimateStory helper.

Verified on PR #24: the suite passes on CI, and a deliberate break — dropping the board page's ensureCurrentIteration call, which no unit test asserts and eslint only warns about — failed 'Run E2E (web)' alone while every other step stayed green (run 30877436863), with the trace artifact uploaded. Measured cost is 58s per run, against the two minutes accepted when the trigger was chosen.
<!-- SECTION:FINAL_SUMMARY:END -->
