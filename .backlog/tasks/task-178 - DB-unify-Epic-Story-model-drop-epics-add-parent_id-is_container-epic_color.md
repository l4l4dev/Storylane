---
id: TASK-178
title: 'DB: unify Epic/Story model (drop epics, add parent_id/is_container/epic_color)'
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-24 04:07'
updated_date: '2026-07-24 04:22'
labels: []
milestone: m-6
dependencies: []
documentation:
  - doc-18
type: feature
ordinal: 1700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the separate epics table + stories.epic_id label model with a self-referencing 1-level hierarchy on stories (doc-18 §1-§2). Foundation for the whole Epic/Story unification. Migration cost / existing data preservation is out of scope (owner: ideal end state first).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 epics table is dropped; stories.epic_id and its composite FK to epics are removed
- [ ] #2 stories gains parent_id uuid REFERENCES stories(id) ON DELETE SET NULL (NULL = top-level)
- [ ] #3 stories gains is_container boolean NOT NULL DEFAULT false (no client write grant/policy — app-layer read-only) and epic_color text
- [ ] #4 lib/database.types.ts regenerated; queries/tests that referenced epics or stories.epic_id compile against the new schema (repository layers Web/iOS)
- [ ] #5 matches spec/data-model.md + SPEC.md + spec/rls.md (already updated in the doc-18 spec pass)
- [ ] #6 CHECK (NOT is_container OR (points IS NULL AND state_id IS NULL AND iteration_id IS NULL)) on stories makes the container off-the-board property a permanent invariant, not a one-time trigger clear (doc-18 §4, decision-1)
<!-- AC:END -->
