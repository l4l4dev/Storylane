---
id: TASK-98
title: 'Release prep: squash migrations into one baseline + full production reset'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-19 00:49'
updated_date: '2026-07-21 06:00'
labels: []
milestone: m-1
dependencies:
  - TASK-94
  - TASK-103
priority: medium
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Before public release, collapse the ~69 files in supabase/migrations/ into a single baseline migration and wipe all test data from the hosted (production) Supabase project. Safe only because the production DB is fully reset in the same operation — no environment keeps the old migration history. Granular history remains in git.

Scope:
- Run after TASK-94 (production verification uses the existing test data; this task deletes it).
- Squash via supabase CLI (e.g. 'supabase migration squash' or schema dump → single baseline file), delete the old migration files.
- Reset the linked production DB and re-apply the baseline (supabase db reset --linked or equivalent + migration history repair). This also deletes auth users, including the owner's account — owner re-signs-up afterwards.
- Coordinate with the CI deploy pipeline from TASK-96 so the auto-apply step does not fail on the rewritten migration history (push squash commit and reset in the same window).
- Update references to individual migration filenames in git-tracked docs (architecture notes SessionStart hook doc, spec/, REVIEW.md if any) to point at the baseline.
- Local dev: supabase db reset to confirm the baseline applies cleanly from scratch before touching production.

Destructive: production reset requires explicit owner go-ahead at execution time.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 supabase/migrations/ contains a single baseline migration (plus any files added after the squash), and 'supabase db reset' locally applies it cleanly with all tests green
- [ ] #2 Production DB is reset and re-applied from the baseline; migration history table matches; app works (sign-in + create project smoke check)
- [ ] #3 CI deploy pipeline (TASK-96) passes on the first push after the squash
- [ ] #4 No git-tracked doc references a deleted migration filename
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Runbook designed by Fable advisor 2026-07-20. PRECONDITIONS: TASK-94 done; all feature branches merged or parked (squash rewrites history under them); freeze window agreed with owner. (1) LOCAL: from a clean 'supabase db reset' state, generate the baseline via schema dump (supabase db dump --local -f supabase/migrations/<ts>_baseline.sql after moving old files out) — dump, not hand-squash, so grants/triggers/sequence defaults survive exactly; delete the ~74 old files in the same commit. Verify: supabase db reset applies the single baseline cleanly; FULL test suite + RLS integration tests green. (2) DOCS: grep git-tracked docs for '20260[67]' migration filename references (ARCHITECTURE.md has several, spec/, REVIEW.md) and repoint to the baseline. (3) PRODUCTION WINDOW (owner go-ahead required at execution — destructive): a. disable the Deploy workflow (GitHub Actions UI) so no push half-applies; b. commit+push the squash; c. supabase db reset --linked (wipes data AND auth users incl. owner); d. re-enable workflow, trigger it (or manual db push) — migration history now matches the baseline; e. owner re-signs-up, re-creates project, re-configures git-webhook secret + Slack integration rows (all integration rows died with the reset). (4) POST: production smoke (sign-in, create project, quick-add) = AC#2; next ordinary push must go green end-to-end = AC#3. ROLLBACK: before step 3c take 'supabase db dump --linked --data-only' as a safety copy; restoring = re-apply old migration chain from git + data dump. NOTE: personal-project trigger (TASK-93) must be in the baseline before reset so the owner's re-signup exercises it.
<!-- SECTION:PLAN:END -->
