---
id: TASK-201
title: 'CI: run the integration suite against a fresh Supabase stack'
status: In Progress
assignee:
  - '@claude-opus-5'
created_date: '2026-07-26 16:00'
updated_date: '2026-07-27 02:28'
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

---

/code-review round 2 (run against the TASK-203 branch state) raised 4 more items on this workflow. Outcome:

- major, auth rate limit — NOT REPRODUCED, no change made. The reviewer read `sign_in_sign_ups = 30` per 5 min per IP from supabase/config.toml and predicted 429s once the suite's ~52 sign-ins burst from one runner IP. Measured instead: 45 valid password grants back to back returned 45x 200, and 45 invalid ones 45x 400 — 90 auth requests in about a minute, zero 429. The limit is not enforced on the password grant endpoint in the local stack. An earlier independent review reached the same result with 40 requests, and the full integration suite passes. Left config.toml alone rather than raising a limit that provably does not apply; if CI ever does return 429, raising sign_in_sign_ups is the one-line fix.
- major, shared-state race between parallel files — REAL, fixed. vitest defaults to one worker per core, so integration files ran concurrently against one database and one seeded dev user: working-day-calendar.integration.test.ts wipes that user's user_time_off rows with a blanket delete while capacity/planning-capacity read them. It passes today only because the fixture dates happen not to overlap. apps/web/vitest.config.ts now sets fileParallelism: false when SUPABASE_INTEGRATION=1. Measured cost: 14.5s -> 74.3s, still 1094/1094. Serialising the whole suite instead of only the integration lane keeps it to one flag, and the default unit run is untouched.
- minor, silent empty env — fixed. Added `: "${API_URL:?...}"` guards for the three variables. exit-code propagation was already handled in round 1; this covers the other half, where status succeeds but reports renamed keys. Left supabase/setup-cli at version: latest to stay consistent with deploy.yml.
- minor, deploy.yml race — no action, already documented in the step comment and tracked as TASK-204.

---

FIRST CI RUN: infrastructure green, 36 tests red. Root cause found and fixed.

What CI proved worked: the -x service-exclusion list on the runner, supabase start applying all 116 migrations, and the integration lane actually running (1094 collected, not 836).

What it exposed: 10 files / 36 tests failing, identically on two consecutive runs. Ruled out in order —
- database state: supabase db reset (owner-approved, local dev data discarded) then a full run passed 1094/1094, so a clean database is not the trigger;
- container/CLI versions: pinning supabase/setup-cli to 2.109.1, the local version, reproduced the failure set byte for byte;
- a timing race: two runs produced the identical 36, so it is deterministic;
- GoTrue session clobbering between two signed-in clients: a throwaway probe showed no clobber (but see below — the probe itself ran on Node 26, which is why it read clean).

Actual cause: every Supabase client in a file shares the storage key sb-127-auth-token. On CI's Node 22 the jsdom localStorage works, so a client created to be anonymous inherits the previous sign-in and clients playing different roles overwrite each other's session. On the owner's Node 26.5.0 the built-in localStorage is inert without --localstorage-file, so each client falls back to memory and every test passes. That is exactly the .nvmrc-22-vs-local-26 mismatch flagged in the review that opened this chain.

Both failure polarities follow from it: 'rejects an unauthenticated call' failed because the anonymous client was in fact signed in, while the 42501 denials happened where a client acted as the wrong user.

Reproduced locally with NODE_OPTIONS=--localstorage-file=... — 10 files / 36 tests, matching CI exactly, which turned a 5-minute CI cycle into a 70-second one.

Fix: { auth: { persistSession: false } } on all 51 anon createClient sites across 32 files, matching what the service-role client already did everywhere and what profiles-is-agent.integration.test.ts (the one anon client that already had it, and the one file that never failed) was doing. Verified 1094/1094 both with the localStorage flag and without it, plus tsc and lint clean. The convention is recorded in apps/web/CLAUDE.md so the next author does not rediscover it.

Test-only defect: the production clients in apps/web/lib/supabase/ use @supabase/ssr with cookie storage and are unaffected.
<!-- SECTION:NOTES:END -->
