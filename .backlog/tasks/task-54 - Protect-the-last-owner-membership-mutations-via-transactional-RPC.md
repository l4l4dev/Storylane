---
id: TASK-54
title: 'Protect the last owner: membership mutations via transactional RPC'
status: In Progress
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 16:10'
updated_date: '2026-07-15 01:13'
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
- [x] #1 The last owner of a project cannot be removed or demoted by any path (RPC, direct table write, invite_member)
- [x] #2 Membership mutations are RPC-only; direct UPDATE/DELETE on project_members is no longer permitted for admin operations
- [x] #3 Integration tests cover the final-owner invariant and membership-policy edge cases
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Migration 20260715000004_membership_admin_rpcs.sql: change_member_role(project,user,role) + remove_member(project,user) SECURITY DEFINER, advisory lock hashtext('membership:'||project); owner-gated (remove_member also allows self-leave); last-owner guard (count owners under lock); invalid-role/target-exists guards. Fix invite_member: ON CONFLICT DO NOTHING + raise 'already a member' if not inserted (never overwrites role). DROP 'owners can update member roles' + 'owners can remove members' policies (RPC-only now).
2. actions.ts: updateMemberRole -> rpc change_member_role returning {error?,success?}; removeMember -> rpc remove_member returning state. Extract client MemberList component (useActionState) surfacing last-owner error inline (ux #2). Wire into settings/page.tsx.
3. Integration test membership.integration.test.ts (dev user + a second admin-created user): outsider/viewer denied; member self-leave; owner removes member; last owner cannot demote/remove self; co-owner demotable while another owner remains; direct UPDATE/DELETE denied for owner; invite re-invite raises. Apply migration, regen types.
4. rls-security-reviewer, spec/rls.md update if needed, verification, commit.
<!-- SECTION:PLAN:END -->

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

IMPLEMENTED (2026-07-15, Opus 4.8):
- Migration 20260715000004_membership_admin_rpcs.sql: change_member_role(project,user,role) + remove_member(project,user) SECURITY DEFINER with per-project advisory lock hashtext('membership:'||project). change_member_role owner-gated (coalesce fail-closed), rejects demoting last owner (count under lock). remove_member allows owner OR self-leave (auth.uid()=target), rejects removing last owner, idempotent. invite_member rewritten insert-only (ON CONFLICT DO NOTHING + raise 'already a member' if not inserted) — no more role overwrite. DROPPED 'owners can update member roles' + 'owners can remove members' policies (RPC-only). Applied locally, types regenerated.
- actions.ts: updateMemberRole -> rpc change_member_role, removeMember -> rpc remove_member, both return MemberActionState {error?}. New client component member-list.tsx (useActionState per row) surfaces the last-owner error inline (ux #2); non-owners get a self 'Leave' button (self-leave gap fix). settings/page.tsx swapped to <MemberList>.
- spec/rls.md: documented the RPC-only membership admin + last-owner invariant + self-leave.
- Tests: membership.integration.test.ts (SUPABASE_INTEGRATION, creates a 2nd user via admin API) — 9 pass: owner role change; last owner can't demote/remove self; co-owner demotable while another owner remains; non-owner denied; member self-leave; owner removes member; direct UPDATE/DELETE by owner affects 0 rows; re-invite raises without changing role. Full web suite 425 pass, tsc/eslint clean.
Reviews: rls-security-reviewer in progress.

REVIEW DONE (rls-security-reviewer, 2026-07-15): no High/Medium issues, ready to ship. Verified via supabase db reset + psql: migration applies cleanly; project_members RLS enabled with only SELECT + owner-INSERT policies (both UPDATE/DELETE dropped); all 3 functions prosecdef + search_path=public; authenticated has EXECUTE (correct user-facing-RPC pattern, vs finish_story_from_git's service-role-only). Traced the last-owner TOCTOU across two concurrent-owner interleavings — the pre-lock permission check is benign, the owner-count recheck under the advisory lock is the airtight invariant. invite_member not taking the lock is safe (insert-only can only raise owner count). Retained owner-INSERT policy is inert (invite_member is SECURITY DEFINER) and harmless if hit directly (PK blocks role overwrite, FK/check still enforced). Self-leave scoped to caller's own row. Only nit (#9, cosmetic, non-blocking): DOWN block for invite_member was a pointer comment — inlined the full old body. spec/rls.md confirmed in sync.
<!-- SECTION:NOTES:END -->
