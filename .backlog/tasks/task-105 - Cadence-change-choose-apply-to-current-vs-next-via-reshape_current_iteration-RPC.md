---
id: TASK-105
title: >-
  Cadence change: choose apply-to-current vs next, via reshape_current_iteration
  RPC
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 05:59'
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
- [ ] #1 New RPC reshape_current_iteration(p_iteration_id): reads iteration_length from projects itself (no client value, closes TOCTOU); for 1-day re-derives end_date via DB-side next_working_day (reuse finalize_iteration's branch, no client calendar re-impl); takes the same hashtext('iteration_finalize:'||project_id) advisory lock + re-read-after-lock as override_iteration_length and reuses its guards (not-past, <=90d, no-op-if-unchanged)
- [ ] #2 reshape_current_iteration returns an explicit error when the project has no current iteration (v_latest IS NULL) — a brand-new project reached via a Settings deep-link before /board ran ensureCurrentIteration
- [ ] #3 Project Settings shows the apply-scope choice only when iteration_length actually changes; default is 'from next' (no reshape call)
- [ ] #4 Spec note added (spec/velocity.md §3): the default 'from next' path leaves the running iteration date-titled-but-multi-day-span until it ends (expected, from TASK-87's title-derivation); the reshape path realigns it
- [ ] #5 Migration/RPC passes rls-security-reviewer; UI passes fable-advisor design review; concurrency test (reshape vs finalize/override under the lock); pnpm test + lint green
<!-- AC:END -->
