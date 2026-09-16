---
id: TASK-255
title: >-
  Tracker step 1a: remove the doc-8 domain, squash migrations, Tracker schema
  and permissions
status: In Progress
assignee:
  - '@claude-opus-5'
created_date: '2026-09-16 11:54'
updated_date: '2026-09-16 12:57'
labels: []
milestone: m-10
dependencies: []
references:
  - docs/plans/2026-09-16-tracker-step-1-core-model.md
  - docs/reference/tracker-notes/core-model.md
  - docs/design/2026-09-16-tracker-parity-rewrite-design.md
priority: high
type: feature
ordinal: 100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Storylane is being rebuilt as a faithful Pivotal Tracker copy (design docs/design/2026-09-16-tracker-parity-rewrite-design.md). The doc-8 domain (project_states/category, board schema, doc-8 packages/core modules, the phase-1 board UI) fights Tracker's model and must go before anything Tracker-shaped is built. Nothing from migrations 0000-0004 has shipped, so they are squashed into a fresh 0000 (design §4).

Execute plan Tasks 1-6 of docs/plans/2026-09-16-tracker-step-1-core-model.md on branch rewrite/tracker (never commit to main). Tasks 4 and 5 passed the /advisor gate on 2026-09-16 (corrections in commit 8d5bf20) — do not change the DDL or the permission matrix without a new advisor pass. Task 4 needs an authz-reviewer pass after it lands.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Plan Tasks 1-6 are complete: doc-8 server domain, core modules, fixtures and board UI removed; apps/web keeps the auth pages green
- [ ] #2 A fresh migration 0000 creates the full step-1 schema; a fresh DB boots and the setup/login/invite tests pass
- [x] #3 spec/permissions.md and spec/fixtures/permissions.json describe Tracker's Owner/Member/Viewer matrix and the route-matrix test passes
- [ ] #4 Tracker-shaped activity rows and projects.version are written in the same transaction as every write; GET activity?since_version works
- [x] #5 authz-reviewer pass after Task 4 reported no open findings; /code-review run before the commit proposal
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
authz-reviewer pass after Task 4 (matrix dda89a9): no exploitable holes; M1 load-time 401/404 pin, L2 member:leave note, L3 leave-archived exemption fixed in e3b295d; L4/L5 (follower/owner route shapes) carried to TASK-256 Task 10. Note: AC #5's /code-review half is still pending (owner-run before the PR merge).
<!-- SECTION:NOTES:END -->
