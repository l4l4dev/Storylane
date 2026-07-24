---
id: TASK-182
title: 'RLS review pass: Epic/Story unification migrations'
status: In Progress
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-24 04:07'
updated_date: '2026-07-24 07:59'
labels: []
milestone: m-6
dependencies:
  - TASK-179
  - TASK-180
  - TASK-181
documentation:
  - doc-18
type: task
ordinal: 2100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Run the rls-security-reviewer agent over the doc-18 migrations (project rule for migrations) before merge/deploy. Confirm no policy gaps from dropping epics and adding split_story / parent_id.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 rls-security-reviewer pass completed; findings triaged with the owner (hold merge on findings per CLAUDE.md)
- [x] #2 confirms: is_container has no client write path; split_story grant is minimal; parent_id writes ride the existing member UPDATE policy; dropped epics policies leave no orphaned grants
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
rls-security-reviewer pass over the 5 chain migrations (178-181). One HIGH, rest clean.

HIGH (empirically reproduced live): is_container was client-forgeable. stories has an unconditional owner/member UPDATE policy + blanket column-less GRANT UPDATE to authenticated, and no trigger guarded the is_container column (maintain_is_container fires only on parent_id writes). A raw REST PATCH 'UPDATE stories SET is_container=false, points=5, state_id=X' let a member un-containerize a real epic (children still nested) and route around the off-board CHECK + the set_story_state guard (both trust is_container). Violates decision-1.

Remediation (owner-approved, migration 20260724075153): BEFORE INSERT OR UPDATE trigger stories_derive_is_container (SECURITY DEFINER, execute revoked from public/anon/authenticated) deriving new.is_container := exists(children of new.id) — overwrites any client value. Chosen over the reviewer's pin-to-OLD+GUC option: simpler, needs no recompute change (recompute's own write equals the derived value), and makes is_container truly derived. A forged is_container=false on a container is forced true, so a same-statement re-estimation trips the off-board CHECK. TDD: 3 forgery tests added to nesting.integration.test.ts (RED before, GREEN after).

Re-run rls-security-reviewer confirmed HIGH CLOSED (live psql): original attack now REJECTED by the CHECK; flag-only forgery both directions is a no-op; legit containerize/revert intact; set_story_state friendly guard unaffected; trigger grant-locked; no cross-project read; no regression. Chain clear to merge from the RLS gate.

AC#2 confirmed: is_container now has NO client write path (fixed); split_story grant minimal (authenticated only, fail-closed); parent_id rides the member UPDATE policy with trigger-enforced integrity; dropped epics/promote leave no orphaned grants. Verified: db reset clean; chain integration 26/26 (incl. 3 new forgery tests); web unit 693; lint + tsc clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
rls-security-reviewer pass on the doc-18 chain: found + fixed a HIGH (is_container was client-forgeable via the unconditional stories UPDATE policy). Remediation migration 20260724075153 derives is_container from child membership on every write; re-review confirmed the hole is closed live. Rest of chain clean. 26/26 integration incl. forgery tests, 693 unit, lint+tsc clean.
<!-- SECTION:FINAL_SUMMARY:END -->
