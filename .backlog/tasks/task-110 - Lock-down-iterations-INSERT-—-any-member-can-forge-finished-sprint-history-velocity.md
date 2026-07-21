---
id: TASK-110
title: >-
  Lock down iterations INSERT — any member can forge finished-sprint
  history/velocity
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 10:59'
updated_date: '2026-07-21 11:16'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 10700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 finding #1 (confirmed live exploit). supabase/migrations/20260627000004_iterations.sql:26 has no INSERT restriction — any owner/member can insert an arbitrary iterations row (state/velocity/capacity/number), unlike the UPDATE-side lockdown in 20260720000002_iteration_capacity.sql. finalize_iteration is SECURITY DEFINER and is already the sole intended writer of new rows.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Migration revokes table-level INSERT on iterations from authenticated (mirroring the UPDATE lockdown)
- [x] #2 finalize_iteration (and any other legitimate SECURITY DEFINER writer) still creates iterations successfully — integration test covers it
- [x] #3 A test proves a direct authenticated-role INSERT is rejected — the forged-history exploit from doc-13 no longer works
- [x] #4 Migration passes rls-security-reviewer; pnpm test + lint green
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Locked down iterations INSERT (doc-13 finding #1). New migration 20260721000006_iterations_insert_lockdown.sql revokes table-level INSERT on public.iterations from authenticated and drops the now-dead 'members can create iterations' policy (defense-in-depth: RLS with no INSERT policy denies even if a future migration re-grants the privilege). Mirrors the TASK-86 UPDATE lockdown. Confirmed no legitimate client INSERT path exists — every new iteration row (incl. a new project's first, via ensureCurrentIteration) is written by the finalize_iteration SECURITY DEFINER RPC (postgres-owned, unaffected). Verified live: the forged-history attack INSERT (state=done, number=999999, velocity=999999, capacity=0.001) as an authenticated member now fails with permission denied, while finalize_iteration still creates iteration #1. New opt-in integration test (iterations-insert-lockdown.integration.test.ts, 2 cases) covers both; flexible-cadence (8) + grant-lockdown (3) integration tests still green as regression. rls-security-reviewer: clean, no gap (fixed its 2 cosmetic nits — stale skip_iteration comment reference + added a spec/rls.md bullet). Full web suite (557) + lint green.
<!-- SECTION:FINAL_SUMMARY:END -->
