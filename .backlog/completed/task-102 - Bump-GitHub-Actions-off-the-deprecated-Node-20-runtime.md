---
id: TASK-102
title: Bump GitHub Actions off the deprecated Node 20 runtime
status: Done
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-21 05:11'
updated_date: '2026-07-21 05:14'
labels:
  - ci
dependencies: []
priority: medium
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
GitHub Actions is deprecating the Node 20 runtime (https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/); runners force Node20-targeting actions onto Node 24 and emit a warning. The Deploy workflow run warns: 'actions/checkout@v4, supabase/setup-cli@v1' target Node 20. Bump the affected actions to versions that run on Node 24. actions/checkout is Node 24 from v5+ (latest major v7); supabase/setup-cli is a composite Node-24 action from v3 (v3.0.0, 2026-07-07). checkout@v4 is used in all three workflows (deploy.yml, web-ci.yml, ios-ci.yml), so bump it repo-wide.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 deploy.yml uses actions/checkout@v5 and supabase/setup-cli@v3 (no more Node 20 warning on the deploy run)
- [x] #2 checkout bumped to @v5 in web-ci.yml and ios-ci.yml too (same deprecated action)
- [x] #3 supabase/setup-cli@v3 still accepts 'version: latest' and db push / functions deploy still work (verified on next deploy, or reasoned from v3 inputs)
- [x] #4 Remaining actions (actions/setup-node@v4, actions/cache@v4, pnpm/action-setup@v4, maxim-lobanov/setup-xcode@v1) checked: bump any that also target Node 20, or note why deferred
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified each action's action.yml runs.using: actions/checkout@v5=node24 (latest major is v7; v5 is the first node24 major, minimal bump), supabase/setup-cli@v3=composite/node24 (still accepts version input), actions/setup-node@v5=node24, actions/cache@v5=node24, pnpm/action-setup@v6=node24 (bare usage auto-detects pnpm version from root package.json packageManager field). maxim-lobanov/setup-xcode@v1 already runs on node24 (its v1 tag was patched) — left unchanged. All inputs unchanged across the bumps, so no workflow-logic changes.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Bumped every Node20-targeting action to a node24 major across all three workflows: deploy.yml (checkout v4->v5, supabase/setup-cli v1->v3), web-ci.yml (checkout v4->v5, pnpm/action-setup v4->v6, setup-node v4->v5), ios-ci.yml (checkout v4->v5, cache v4->v5). setup-xcode@v1 already node24, unchanged. Each target verified via the action's action.yml runs.using; inputs unchanged so behavior is preserved. Real CI validation happens on push.
<!-- SECTION:FINAL_SUMMARY:END -->
