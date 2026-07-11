---
id: TASK-2
title: 'Task 13: Polish & QA (Web)'
status: Done
assignee:
  - '@claude'
created_date: '2026-07-07 08:44'
updated_date: '2026-07-07 14:38'
labels: []
dependencies: []
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Error/empty states, loading skeletons, responsive layout, a11y audit, Playwright E2E for the core flow (create project -> add story -> complete iteration), performance review, and the dnd-kit hydration warning fix. Runs after Task 14 so the board is final.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Playwright E2E covers the core flow and passes locally
- [x] #2 dnd-kit aria-describedby hydration warning is resolved
- [x] #3 All views have error and empty states; data-fetching screens have loading skeletons
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Scope confirmed 2026-07-07 with the owner: TASK-2's 3 ACs only (responsive/a11y/performance deferred, not in this round). Plan: docs/superpowers/plans/2026-07-07-task-13-polish-qa.md. Implemented: (1) dnd-kit DndContext id fix on all 3 board components, resolving the aria-describedby hydration warning; (2) Skeleton primitive + loading.tsx on 7 routes (dashboard/board/epics/iterations/activity/settings/story-detail); (3) ErrorState primitive + error.tsx on app/, app/projects/ (catches [id]/layout.tsx errors), app/projects/[id]/, app/stories/[id]/; (4) board empty-state messages (zero stories in pivotal mode, zero columns in free mode) -- caught and fixed a regression during manual verification where the first version hid the quick-add composer entirely on an empty board; (5) Playwright installed + configured, core-flow.spec.ts covering create project -> quick-add story -> Start/Finish/Deliver/Accept via List view one-click buttons -> backdate current iteration via Supabase admin client -> reload triggers lazy rollover -> verify finalized iteration + velocity on /iterations page. tsc/eslint/vitest(181 tests)/pnpm build all pass. E2E passed cleanly once (16.8s); this shared dev machine has variable load (load avg seen up to ~9-10) that intermittently slows the dev server's iteration-rollover request well beyond Playwright's timeout -- confirmed environmental via pg_stat_activity (no blocking queries) and process inspection (next-server CPU climbing under load), not an app or test bug. Bumped playwright.config.ts timeouts accordingly. Also noticed (unrelated, untouched by me): a large concurrent edit in progress on spec/data-model.md, spec/features.md, spec/screens.md, spec/glossary.md, spec/rls.md, spec/velocity.md, ARCHITECTURE.md -- left entirely alone, only ever staged files by explicit name.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Task 13 (TASK-2's 3 in-scope ACs) complete: dnd-kit hydration warning fixed, loading skeletons + error boundaries + board empty states added across all views, Playwright E2E for the core flow added and passing. tsc/eslint/vitest/build all green. Responsive layout, a11y audit, and performance review are explicitly out of scope for this round per the owner's 2026-07-07 confirmation.
<!-- SECTION:FINAL_SUMMARY:END -->
