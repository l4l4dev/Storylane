---
id: TASK-204
title: Gate production deploys behind an explicit GitHub Release
status: In Progress
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-26 16:01'
updated_date: '2026-07-30 19:26'
labels:
  - ci
milestone: m-1
dependencies:
  - TASK-201
references:
  - .github/workflows/deploy.yml
  - DEPLOY.md
priority: medium
ordinal: 1250
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
deploy.yml currently fires on every push to main: each merge applies migrations and triggers the Vercel production deploy. The owner wants releases batched and deliberate instead — cut a release with notes, and that act is what ships.

GitHub Releases cover this natively: switch the trigger to `on: release: types: [published]`, and generate notes with `gh release create <tag> --generate-notes`, which classifies the existing Conventional Commits. No changesets / semantic-release / release-please needed.

The trade-off to hold in mind: batching means migrations reach production in a bundle rather than one or two at a time, so a mid-bundle failure leaves production half-migrated. TASK-201 (CI applies the whole chain to an empty database on every PR) is the safety net that makes this acceptable, hence the dependency.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Merging to main no longer deploys to production on its own
- [x] #2 Publishing a GitHub Release runs migrations, Edge Functions and the Vercel deploy hook, in that existing order
- [x] #3 Release notes are generated from the Conventional Commit history rather than written by hand
- [x] #4 The production-deploy concurrency group still prevents overlapping releases
- [x] #5 DEPLOY.md describes the release procedure the owner now follows
- [x] #6 deploy.yml no longer races web-ci.yml: with the release trigger, no push to main can apply a migration to production while CI is still running (see the comment in web-ci.yml's Start Supabase step)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. deploy.yml: switch the trigger from 'on: push: branches: [main]' to 'on: release: types: [published]'. No other job/step changes — same three steps in the same order, same concurrency group.
2. web-ci.yml: its 'Start Supabase' step comment described the race this task closes; update it to state the current (post-fix) relationship instead of narrating the fix as a future event.
3. DEPLOY.md: rewrite 'How a deploy works' to state that pushing to main no longer deploys; add a 'Cutting a release' section describing 'gh release create v<version> --generate-notes' (creates the tag, generates notes from commit/PR history, publishes — publishing triggers the deploy) and the --target / --draft variants. Merge the old standalone 'Versioning' section into it (same procedure, was previously describing the pre-fix push-triggers-deploy flow).
4. No application code changes — nothing to run through the JS test suite. Validated deploy.yml and web-ci.yml as syntactically valid YAML (js-yaml).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC evidence:
#1 the only trigger left on deploy.yml is `release: types: [published]` — a push to main no longer matches any trigger on that workflow.
#2 the three steps (migrations, Edge Functions, Vercel deploy hook) are unchanged and in the same order; only the `on:` block was edited.
#3 DEPLOY.md's "Cutting a release" section documents `gh release create v<version> --generate-notes`, which per `gh release create --help` generates notes from the commits/PRs since the last release via the GitHub Release Notes API.
#4 the `concurrency: { group: production-deploy, cancel-in-progress: false }` block is untouched.
#5 DEPLOY.md's "How a deploy works" and "Cutting a release" sections describe the full procedure: push to main (no deploy) -> bump version, commit, push -> `gh release create ... --generate-notes` (publishes, triggers deploy). The old "Versioning" section, which described the pre-fix push-triggers-deploy flow, is merged into it rather than left duplicating/contradicting it.
#6 deploy.yml only fires on a published release; a push to main (including one CI is still validating) can no longer trigger it at all, so there is no push-triggered deploy left to race web-ci.yml's migration-chain check. Updated that check's comment in web-ci.yml, which previously described the race as still-open and pointed at this task to close it.

Verification: `.github/workflows/deploy.yml` and `.github/workflows/web-ci.yml` parse as valid YAML (checked with the repo's own js-yaml dependency). No application code touched, so no JS test/lint/tsc run applies. `gh release create`'s default-publishes / `--draft` / `--target` behavior confirmed against `gh release create --help` rather than assumed.

HOLD (owner, 2026-07-31): Codex P1 on PR #16 found that the final Vercel Deploy Hook step builds Vercel's configured production branch (main) rather than the exact commit checked out for migrations/Edge Functions — the Deploy Hook URL has no way to pin a commit. This is reachable through the --target <sha> release procedure this task's DEPLOY.md documented (releasing an older commit), and more narrowly even without it (another commit landing on main mid-job). It defeats the "new code never runs against an old schema" guarantee deploy.yml's own header comment claims.

Fix requires switching the last step to a Vercel CLI prebuilt deploy of the checked-out workspace (vercel pull --environment=production / vercel build --prod / vercel deploy --prebuilt --prod), which needs three new secrets only the owner can create: VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID (from the Vercel dashboard or `vercel link`). Owner chose to hold rather than proceed now.

PR #16 (branch chore/gate-deploy-behind-release) stays open, unmerged, with the trigger-gating change (AC#1/#2/#4/#6) and the DEPLOY.md/web-ci.yml updates (AC#3/#5) already on it — the P1 blocks merge. Resume by adding the three secrets, replacing the "Trigger Vercel production deploy" step, and updating DEPLOY.md's setup table + the deploy.yml header comment to match.
<!-- SECTION:NOTES:END -->
