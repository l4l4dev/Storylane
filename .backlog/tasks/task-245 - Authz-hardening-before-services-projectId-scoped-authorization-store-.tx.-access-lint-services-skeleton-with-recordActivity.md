---
id: TASK-245
title: >-
  Authz hardening before services: projectId-scoped authorization store, .tx.
  access lint, services skeleton with recordActivity
status: Done
assignee:
  - '@claude-opus-5'
created_date: '2026-09-07 02:54'
updated_date: '2026-09-07 03:55'
labels: []
milestone: m-9
dependencies: []
references:
  - docs/design/2026-09-05-self-host-rewrite-design.md
  - apps/server/src/db/tx.ts
priority: high
type: feature
ordinal: 100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Phase-1 carry-over from TASK-240 (final review made it the first phase-1 item). Today the fail-closed store only counts authorizations; a handler that authorizes project A and reads project B via a raw db still passes. Make the store hold the set of authorized project ids and have failClosed verify c.req.param('id') is in it. Add an ESLint rule forbidding '.tx.' member access on a ProjectTx outside apps/server/src/db/ and apps/server/src/services/. Create the services layer skeleton: apps/server/src/services/ with recordActivity(tx, entry) writing activity_logs (table added here), the convention that routes call services and services receive a ProjectTx, and one example service used by GET /api/projects/:id. Document 'one withProject per request' and enforce it with a test (nested call throws a clear error).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Route-matrix test includes a case where a handler authorizes project A and touches project B: response is 500 authorization_missing
- [ ] #2 Lint fails on tx.tx usage in a route file and passes in src/db and src/services (fixture tests)
- [ ] #3 activity_logs table exists (migration), recordActivity(tx, …) is the only writer, and a test proves a service write and its activity row commit or roll back together
- [ ] #4 Nested withProject inside a ProjectTx throws 'withProject cannot be nested' (test)
- [ ] #5 authz-reviewer pass recorded in notes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done on rewrite/phase-1: c691846 + adf377b (project-scoped fail-closed store with position-based id, nesting guard, .tx escape lint incl. destructuring, db/client import fence for services/routes, matrix fixtures + rule guards) and a11a651 (activity_logs migration 0002, recordActivity as sole writer, services skeleton, readProject ProjectDetail). authz-reviewer pass on c691846: approve with fixes (F1-F4 fixed in adf377b, F5 SSE → TASK-251). Reviews: 2 task reviews + 1 scoped re-review. Deferred: BootstrapScope branding (decide in TASK-249), ptx[k] dynamic keys out of lint reach (documented).
<!-- SECTION:NOTES:END -->
