---
id: TASK-204
title: Gate production deploys behind an explicit GitHub Release
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-26 16:01'
updated_date: '2026-07-28 00:50'
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
- [ ] #1 Merging to main no longer deploys to production on its own
- [ ] #2 Publishing a GitHub Release runs migrations, Edge Functions and the Vercel deploy hook, in that existing order
- [ ] #3 Release notes are generated from the Conventional Commit history rather than written by hand
- [ ] #4 The production-deploy concurrency group still prevents overlapping releases
- [ ] #5 DEPLOY.md describes the release procedure the owner now follows
- [ ] #6 deploy.yml no longer races web-ci.yml: with the release trigger, no push to main can apply a migration to production while CI is still running (see the comment in web-ci.yml's Start Supabase step)
<!-- AC:END -->
