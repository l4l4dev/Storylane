---
id: TASK-267
title: 'Route matrix: tell an action 403 apart from a service 403'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-17 08:46'
labels: []
milestone: m-10
dependencies:
  - TASK-256
priority: low
type: task
ordinal: 850
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the consolidated authz-reviewer pass on TASK-256 (low L3). apps/server/test/route-matrix.test.ts only compares status codes, so a route declared under the wrong action can still pass when a service raises its own 403 for the same role (example: owners/followers routes, where the service's viewer self-guard also answers 403). Give the action-level refusal from authorizeIn a distinct error code, or have the matrix assert the error code of the authorization failure, so every matrix row proves the manifest action itself. Changes db/tx.ts or authz/ and therefore needs an authz-reviewer pass.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The matrix fails if a route passes a different action than its ROUTE_ACTIONS entry, demonstrated by a deliberately broken local check
- [ ] #2 No existing client-facing error code changes without an entry in spec/permissions.md
- [ ] #3 authz-reviewer pass recorded in the task notes
- [ ] #4 bun test, lint and typecheck in apps/server are green
<!-- AC:END -->
