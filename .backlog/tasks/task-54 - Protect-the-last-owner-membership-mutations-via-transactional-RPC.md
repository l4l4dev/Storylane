---
id: TASK-54
title: 'Protect the last owner: membership mutations via transactional RPC'
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 16:10'
updated_date: '2026-07-11 19:33'
labels:
  - security
  - rls
  - db
milestone: m-1
dependencies: []
priority: high
ordinal: 14400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex full-codebase review (2026-07-12), High: project_members RLS (20260627000002_projects.sql:109-116) lets any owner update/delete ANY membership row — including demoting or deleting the final owner — and invite_member can overwrite an existing owner's role. A project can become ownerless (no settings, archive, delete, or member admin possible) or a co-owner can lock another owner out.

Fix: centralize membership mutations (role change, removal) in transactional RPCs that lock the project's membership rows and reject removal/demotion of the last owner; tighten/revoke the direct UPDATE/DELETE policies for membership administration; make invite_member refuse to change an existing owner's role. Include the review's test-coverage finding: DB integration tests for outsider access, viewer restrictions, self-removal, co-owner mutations, and the final-owner invariant. Migration — run rls-security-reviewer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The last owner of a project cannot be removed or demoted by any path (RPC, direct table write, invite_member)
- [ ] #2 Membership mutations are RPC-only; direct UPDATE/DELETE on project_members is no longer permitted for admin operations
- [ ] #3 Integration tests cover the final-owner invariant and membership-policy edge cases
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Full Codex report: backlog doc-1 (.backlog/docs/reviews/) — read the matching finding before implementing.

DESIGN (Fable, 2026-07-12 — treat as the advisor-approved design):
RPCs (SECURITY DEFINER, per-project advisory lock 'membership:'||project_id to serialize concurrent admin actions):
1. change_member_role(p_project_id, p_user_id, p_role) — caller must be owner; raises if the target is the LAST owner being demoted (count owners under the lock).
2. remove_member(p_project_id, p_user_id) — allowed when caller is owner, OR caller = target (self-leave, which today is impossible for non-owners — fixing that gap is included); raises if target is the last owner.
RLS CHANGES (20260627000002_projects.sql): DROP the owner UPDATE policy and the owner DELETE policy on project_members — role changes and removals become RPC-only. Keep SELECT and the owner INSERT policy (invite_member also inserts). This is the fail-closed shape: no direct path can violate the invariant.
invite_member FIX (20260709000003): the upsert must not modify an EXISTING member's role at all (insert-only semantics; re-inviting an existing member returns a no-op/informative result) — that closes the owner-overwrite hole without touching the invariant logic.
TESTS (use the local RLS verification harness from the TASK-18 era): outsider denied; viewer denied; member self-leave OK; owner removes member OK; last owner cannot demote/remove self; co-owner CAN be demoted while another owner remains; direct UPDATE/DELETE on project_members now denied for owners too. Run rls-security-reviewer on the migration. NOTE for Web UI: settings member management must switch to the RPCs and surface the 'last owner' error clearly (ux-principles #2).
<!-- SECTION:NOTES:END -->
