---
id: TASK-54
title: 'Protect the last owner: membership mutations via transactional RPC'
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 16:10'
labels:
  - security
  - rls
  - db
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
