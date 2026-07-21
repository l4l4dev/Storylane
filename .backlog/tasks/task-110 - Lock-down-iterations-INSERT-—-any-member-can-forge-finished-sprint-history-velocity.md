---
id: TASK-110
title: >-
  Lock down iterations INSERT — any member can forge finished-sprint
  history/velocity
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 10:59'
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
- [ ] #1 Migration revokes table-level INSERT on iterations from authenticated (mirroring the UPDATE lockdown)
- [ ] #2 finalize_iteration (and any other legitimate SECURITY DEFINER writer) still creates iterations successfully — integration test covers it
- [ ] #3 A test proves a direct authenticated-role INSERT is rejected — the forged-history exploit from doc-13 no longer works
- [ ] #4 Migration passes rls-security-reviewer; pnpm test + lint green
<!-- AC:END -->
