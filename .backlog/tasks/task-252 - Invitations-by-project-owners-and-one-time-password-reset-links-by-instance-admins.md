---
id: TASK-252
title: >-
  Invitations by project owners and one-time password reset links by instance
  admins
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-07 02:55'
labels: []
milestone: m-9
dependencies:
  - TASK-249
references:
  - docs/design/2026-09-05-self-host-rewrite-design.md
  - spec/permissions.md
priority: medium
type: feature
ordinal: 800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design doc §7 (invite links) and §4 (reset links). Owner mints an invite (POST /api/projects/:id/invites, member:invite) bound to project + role with expiry; token shown once, stored hashed; revocable; GET /api/invites/:token previews; POST /api/invites/:token/accept joins when logged in or registers+joins when logged out. Instance admin (users.is_admin) mints a one-time reset link for a user (adminActions user:reset-link); the reset page sets a new password and revokes all sessions. Web pages for accept and reset. Last-owner invariant is not in scope here (member management task later).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Invite tokens are stored hashed, expire, are single-use and revocable (tests); accepting as a logged-in non-member adds the membership with the bound role
- [ ] #2 Reset link is single-use, expires, and revokes all sessions on use (tests)
- [ ] #3 Non-admin cannot mint reset links (403), anonymous 401; only project owners mint invites (matrix)
<!-- AC:END -->
