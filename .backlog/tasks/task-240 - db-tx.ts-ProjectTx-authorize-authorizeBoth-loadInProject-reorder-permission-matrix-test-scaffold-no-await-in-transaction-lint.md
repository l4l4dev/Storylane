---
id: TASK-240
title: >-
  db/tx.ts: ProjectTx, authorize, authorizeBoth, loadInProject, reorder +
  permission matrix test scaffold + no-await-in-transaction lint
status: Done
assignee:
  - '@claude-opus-5'
created_date: '2026-09-05 15:47'
updated_date: '2026-09-06 01:16'
labels: []
milestone: m-8
dependencies:
  - TASK-239
  - TASK-237
references:
  - docs/design/2026-09-05-self-host-rewrite-design.md
priority: high
type: feature
ordinal: 500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design doc section 3 and the transaction rules of section 5. Implement authorize(actor, projectId, action): ProjectTx so project data can only be read or written through a ProjectTx; authorizeBoth for cross-project operations; loadInProject(tx, table, id) as the only by-id row loader (404 when the row is not in tx.projectId); reorder(tx, table, scope, orderedIds) with the two-step position update. Add the fail-closed middleware for /api/projects/:id/** (500 in every environment when no ProjectTx was obtained). Add the table-driven matrix test scaffold: enumerates every registered Hono route, expects a row per route for owner/member/viewer/non-member/anonymous, and fails on missing rows; it reads spec/fixtures/permissions.json when present. Add an ESLint (or Bun-compatible) lint rule forbidding await inside db.transaction callbacks. Minimal users/projects/project_members tables may be introduced here to make the scaffold runnable.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A service function that touches project tables without a ProjectTx does not type-check (demonstrated by a type-level test)
- [ ] #2 loadInProject returns 404 for a row that exists in another project (test)
- [ ] #3 reorder to a permutation of n rows leaves positions 0..n-1 without UNIQUE violations (test with n=5 including a full reverse)
- [ ] #4 Matrix test runs green with the routes that exist and fails when a new route is registered without a row (demonstrated in a test)
- [ ] #5 Lint fails on await inside db.transaction and passes otherwise (fixture tests)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done on rewrite/self-hosted: 65d3a40 (core), ed6ee45 (14 review fixes: NotPromise + lint on withProject, token-gated _create, ALS-bound fail-closed, matrix hardening, fixture validation, scoped_items out of migrations, disabled_at, precedence 404→409→403), bae410a (live flag + runtime thenable rejection, disabled-before-404, no-op guard removed), b01c502 (async-via-any tests, token-gated _invalidate). Reviewed by SDD task review + 3 scoped re-reviews + authz-reviewer x2. bun test 85/85. PHASE-1 CARRY-OVER (must do before/with first services): (1) projectId-aware authz store — middleware verifies c.req.param('id') is in the authorized set; (2) lint banning '.tx.' outside src/db and src/services; (3) savepoint/nesting support or enforce single withProject per request; (4) last-owner 409 with member routes; (5) explicit write flag in fixture instead of ':read' suffix; (6) email lookups must use COLLATE NOCASE; (7) reorder scope vs UNIQUE test when real tables land; (8) carry project row on ProjectTx to avoid re-query.
<!-- SECTION:NOTES:END -->
