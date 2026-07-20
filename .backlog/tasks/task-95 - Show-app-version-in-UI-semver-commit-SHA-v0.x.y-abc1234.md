---
id: TASK-95
title: 'Show app version in UI: semver + commit SHA (v0.x.y (abc1234))'
status: Done
assignee:
  - '@claude-fable-5'
created_date: '2026-07-18 15:18'
updated_date: '2026-07-19 17:14'
labels: []
milestone: m-1
dependencies: []
priority: medium
ordinal: 66000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner decision 2026-07-19 (option C): display the app version in the web UI as v<semver> (<short commit SHA>), e.g. "v0.2.0 (2209663)". Semver comes from apps/web/package.json (currently 0.1.0, unused); the commit SHA comes from Vercel-provided env (VERCEL_GIT_COMMIT_SHA, or NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA if system env exposure is enabled) — prefer reading it in a server component so no extra env plumbing is needed. Locally there is no Vercel env, so show a dev marker instead of the SHA. Also document the release procedure (bump package.json version + matching git tag vX.Y.Z) in a short note the owner can follow.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Production UI shows "v<package.json version> (<7-char commit SHA>)" somewhere unobtrusive (footer or settings/about)
- [x] #2 Local dev shows the version with a dev marker instead of a SHA and does not crash without Vercel env
- [x] #3 Release procedure (version bump + git tag) is documented in the repo
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. apps/web/lib/utils/app-version.ts: formatAppVersion(version, sha) pure helper -> 'v0.1.0 (abc1234)' / 'v0.1.0 (dev)' + appVersion() reading package.json version and process.env.VERCEL_GIT_COMMIT_SHA (server-side). 2. Render it at the bottom of /settings (server component, unobtrusive muted text). 3. Vitest for the formatter. 4. Release procedure section appended to DEPLOY.md (bump apps/web/package.json + git tag vX.Y.Z). Implemented on Fable directly (owner quota decision 2026-07-19).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: lib/utils/app-version.ts (formatAppVersion + appVersion reading package.json version and VERCEL_GIT_COMMIT_SHA), rendered at the bottom of /settings (server component), 3 unit tests pass, release procedure documented in DEPLOY.md 'Versioning'. Full suite 409 passed / lint clean. AC#1 (production display) verifiable only after the next production deploy; AC#2 covered by the dev-marker unit test; AC#3 done.

AC#1 (production display) deferred to TASK-94 production smoke test, per the deferred-manual-verification policy. AC#2 proven by 3 passing unit tests (vitest run lib/utils/app-version.test.ts, 2026-07-20); AC#3 proven by DEPLOY.md 'Versioning' section.

AC#1 proven 2026-07-20: owner confirmed production settings page shows 'Storylane v0.1.0 (d97554b)'.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added formatAppVersion/appVersion (package.json version + VERCEL_GIT_COMMIT_SHA), rendered at the bottom of /settings; dev fallback shows 'v0.1.0 (dev)'. Verified with 3 unit tests + full suite (409 passed, lint clean). Release procedure documented in DEPLOY.md 'Versioning'. Production display check deferred to TASK-94.
<!-- SECTION:FINAL_SUMMARY:END -->
