---
id: TASK-97
title: 'Add UNIQUE(project_id, name) to labels; make resolveLabelIds ON CONFLICT-based'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-19 00:03'
updated_date: '2026-07-21 03:09'
labels:
  - mcp
  - db
milestone: m-3
dependencies: []
priority: low
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Advisor note during TASK-71: labels has no UNIQUE(project_id, name) constraint (20260627000003), so the MCP resolveLabelIds (apps/mcp/src/handlers.ts, select-then-insert) can create duplicate same-name labels under concurrency; the .order("id").limit(1) only masks the symptom. Add a UNIQUE(project_id, name) constraint via migration and rewrite label creation to be ON CONFLICT DO NOTHING / upsert-based so name resolution is race-free. Check the Web label-create paths for the same pattern. Mechanical, behavior-preserving.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added labels_project_id_name_key UNIQUE(project_id, name) constraint; rewrote MCP resolveLabelIds as a single upsert on that conflict target (race-free); Settings createLabel catches 23505 with a friendly inline message. Verified: rls-security-reviewer pass (upsert's conflict-update path correctly gated by the existing UPDATE policy, viewer correctly denied even on the conflict branch, color never clobbered); 2 new MCP integration tests (concurrent same-name resolution -> 1 row, existing label's color untouched) + 21 existing pass; 1 new web unit test for the duplicate-name message; full suite (535 unit + typecheck + lint) clean.
<!-- SECTION:FINAL_SUMMARY:END -->
