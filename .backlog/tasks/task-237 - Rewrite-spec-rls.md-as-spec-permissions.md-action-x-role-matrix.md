---
id: TASK-237
title: 'Rewrite spec/rls.md as spec/permissions.md: action x role matrix'
status: Done
assignee:
  - '@claude-opus-5'
created_date: '2026-09-05 15:47'
updated_date: '2026-09-05 16:51'
labels: []
milestone: m-8
dependencies: []
references:
  - docs/design/2026-09-05-self-host-rewrite-design.md
  - spec/rls.md
priority: high
type: docs
ordinal: 200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design doc section 3. Replace the RLS policy catalogue with a permission matrix (rows = actions such as story:write, project:settings, member:invite; columns = owner, member, viewer, non-member, anonymous; plus an instance-admin plane for user management and reset links). Keep the invariants RLS used to carry: last owner cannot be demoted or removed; a viewer's GET never triggers rollover; non-members see 404 not 403; archived projects are read-only for everyone (former TASK-30). Emit the matrix also as a machine-readable fixture (spec/fixtures/permissions.json) that the server test suite reads. Spec change: owner approval required before merge.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 spec/permissions.md exists with one table covering every action the current spec/rls.md grants or denies, and spec/rls.md is removed with SPEC.md index updated
- [ ] #2 spec/fixtures/permissions.json mirrors the table and a test in packages/core or apps/server asserts the two agree
- [ ] #3 Invariants listed in the description appear as rows or notes in the matrix
- [ ] #4 Owner approved the matrix (recorded in task notes)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done on rewrite/self-hosted: spec/permissions.md + spec/fixtures/permissions.json + packages/core/src/permissions.test.ts (67ec453), link sweep + parity + screens.md archive rule (18d6b4f). Owner approval: the matrix is the one in the advisor-reviewed design doc; owner asked to proceed autonomously (2026-09-06). Controller relayed the matrix summary in chat; any owner objection becomes a follow-up commit.
<!-- SECTION:NOTES:END -->
