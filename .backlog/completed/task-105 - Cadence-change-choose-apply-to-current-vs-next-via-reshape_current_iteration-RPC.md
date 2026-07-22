---
id: TASK-105
title: >-
  Cadence change: choose apply-to-current vs next, via reshape_current_iteration
  RPC
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 05:59'
updated_date: '2026-07-21 10:07'
labels:
  - web
  - db
dependencies: []
priority: medium
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-11 D3 (+ advisor corrections). When iteration_length changes in Project Settings, offer a choice: 'from the next iteration' (current TASK-87 default, unchanged) OR 'also re-shape the current iteration now'. The re-shape is a NEW RPC, not an extension of override_iteration_length. Keeps TASK-87's stable-running-sprint default and makes re-shaping explicit opt-in. See .backlog/docs/doc-11.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 New RPC reshape_current_iteration(p_iteration_id): reads iteration_length from projects itself (no client value, closes TOCTOU); for 1-day re-derives end_date via DB-side next_working_day (reuse finalize_iteration's branch, no client calendar re-impl); takes the same hashtext('iteration_finalize:'||project_id) advisory lock + re-read-after-lock as override_iteration_length and reuses its guards (not-past, <=90d, no-op-if-unchanged)
- [x] #2 reshape_current_iteration returns an explicit error when the project has no current iteration (v_latest IS NULL) — a brand-new project reached via a Settings deep-link before /board ran ensureCurrentIteration
- [x] #3 Project Settings shows the apply-scope choice only when iteration_length actually changes; default is 'from next' (no reshape call)
- [x] #4 Spec note added (spec/velocity.md §3): the default 'from next' path leaves the running iteration date-titled-but-multi-day-span until it ends (expected, from TASK-87's title-derivation); the reshape path realigns it
- [x] #5 Migration/RPC passes rls-security-reviewer; UI passes fable-advisor design review; concurrency test (reshape vs finalize/override under the lock); pnpm test + lint green
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added reshape_current_iteration(p_project_id) RPC (SECURITY DEFINER; same iteration_finalize advisory lock + re-read as override/finalize; reads iteration_length from projects itself for TOCTOU safety; 1-day via next_working_day; no-ops on no-current/done/would-end-in-past/too-long/unchanged so updateProject never 500s). Settings gets an owner-only 'apply to current' checkbox (default off = from-next, TASK-87). updateProject calls the RPC when checked and throws on a genuine RPC error. describeActivity handles iteration.reshaped. Also fixed a grant-lockdown gap the test caught: protect_projects_is_personal (TASK-103 pin trigger) was missing its EXECUTE revoke. Verified: rls-security-reviewer clean (7 points + the revoke, vs local reset); fable-advisor approve-with-fixes (swallowed RPC error now thrown); 5 reshape integration tests + grant-lockdown + activity + full web suite (525) + tsc + lint green.
<!-- SECTION:FINAL_SUMMARY:END -->
