---
id: TASK-201
title: 'CI: run the integration suite against a fresh Supabase stack'
status: In Progress
assignee:
  - '@claude-opus-5'
created_date: '2026-07-26 16:00'
updated_date: '2026-07-26 16:14'
labels:
  - ci
  - db
milestone: m-2
dependencies: []
modified_files:
  - .github/workflows/web-ci.yml
priority: high
ordinal: 1100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web-ci.yml never started Supabase, so the 35 `*.integration.test.ts` files (258 tests covering RLS, RPCs and triggers) were skipped on every run — and `supabase/**` was not even in the workflow's trigger paths, so a migration-only change ran no CI at all. Meanwhile deploy.yml applies migrations straight to production on merge, making the owner's local `db reset` the only place the migration chain was ever proven to apply in order.

Starting the local stack in CI closes both gaps at once: `supabase start` applies all migrations to an empty database, and the same job can then un-skip the integration suite.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 supabase/** is in the workflow's push and pull_request trigger paths
- [ ] #2 CI starts a local Supabase stack, which applies every migration to an empty database
- [ ] #3 The web test step runs with SUPABASE_INTEGRATION=1 so no integration file is skipped
- [ ] #4 Local Supabase credentials stay scoped to the test step — they must not leak into the Build step, which inlines NEXT_PUBLIC_* at build time
- [ ] #5 A CI run on a real PR reports the full test count, not the reduced one
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Implemented on 2026-07-26. Verified locally: SUPABASE_INTEGRATION=1 full run is 1094/1094 passed in 14.5s; `eval "$(supabase status -o env)"` yields API_URL/ANON_KEY/SERVICE_ROLE_KEY; workflow YAML parses with steps in the intended order. NOT verified: the `-x` service-exclusion list on a GitHub runner (testing it locally would require stopping the owner's dev stack). If Start Supabase fails in CI, dropping the -x list is the fix.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
/code-review (medium) returned 3 findings, all applied:
- medium — the comment claimed this job proves the migration chain before deploy.yml pushes to production. It does not: deploy.yml fires on the same push to main with no needs/workflow_run dependency, and its short checkout+db-push job finishes before this one. Comment corrected to state the real scope (gates the PR, not production) and to point at TASK-204, which removes the race.
- low — `pooler` is not a valid -x name for the current CLI (warning only today, but setup-cli floats on version: latest). Removed; [db.pooler] is disabled anyway.
- low — `eval "$(supabase status -o env)"` discarded status's exit code, so a failure would surface as 'env not set'. Split into an assignment then eval; verified under bash -e that the assignment form exits 1 where the eval form returns 0.

Reviewer independently confirmed: the three env key names, the gate constant across all 35 files, no storage/edge-function use in the suite, and that excluding logflare/vector does not break startup (containers log via json-file).
<!-- SECTION:NOTES:END -->
