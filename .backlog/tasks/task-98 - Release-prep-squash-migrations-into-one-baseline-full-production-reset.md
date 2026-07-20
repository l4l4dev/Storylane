---
id: TASK-98
title: 'Release prep: squash migrations into one baseline + full production reset'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-19 00:49'
labels: []
milestone: m-1
dependencies:
  - TASK-94
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
