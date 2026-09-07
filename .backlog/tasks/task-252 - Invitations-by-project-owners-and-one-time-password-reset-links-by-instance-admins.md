---
id: TASK-252
title: >-
  Invitations by project owners and one-time password reset links by instance
  admins
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-07 02:55'
updated_date: '2026-09-07 13:09'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Task 8b (password reset links) — implemented, reviewed, fixed

Commits: 0dabe8c (implementation, TDD per task-8b-brief.md) + a9d23ed (fixes from
authz-reviewer pass). Full report: .superpowers/sdd/2026-09-07-self-host-phase-1/task-8b-report.md

authz-reviewer verdict on 0dabe8c: issues found (no critical; top severity Medium-High).
All addressed in a9d23ed:
- [Medium-High] credentials_changed_at was stamped with a pre-KDF timestamp, letting a
  session created while hashPassword was running survive the reset. Fixed: timestamp is
  now taken after hashPassword resolves (matches /api/me/password's existing ordering).
- [Medium] using one reset link left a second, still-unused link for the same user valid
  until its own TTL, able to overwrite the just-set password. Fixed: consuming a link now
  spends every other outstanding link for that user in the same transaction.
- [Low-Medium] a disabled user's link could still be minted/consumed. Fixed: mint and
  consume both 404 for a disabled account now.
- [Low] log path redaction missed a trailing-slash variant, risking the raw token in
  `docker logs`. Fixed (also backported to the pre-existing /api/invites/:token pattern).
- [Low] mint response missing Cache-Control: no-store. Fixed.
- [Low] spec/permissions.md + ARCHITECTURE.md updated (Password resets section, route
  manifest entry, Where-things-are row).
Not fixed (flagged as follow-up, out of this task's scope): /api/me/password (self-service
change) doesn't spend outstanding reset links for that user; no cleanup job for expired/used
reset_tokens; no durable audit trail for admin mint beyond the stdout log line; matrix test's
non-admin-403 sweep isn't generalized (only this one admin route, directly tested).

Verification: bun test 491 pass/0 fail, typecheck clean, lint clean, manual curl flow
(mint -> preview -> reset -> old cookie 401 -> new login 200 -> second use 404 -> anon 401 /
non-admin 403 on mint) all as expected.

Acceptance criteria #2 and #3 (reset link single-use/expiring/revokes sessions; non-admin
403, anonymous 401 on mint) are satisfied by this work. #1 (invitations) was TASK-252's
"Task 8a" half, implemented in an earlier commit on this branch — not re-verified here.

Controller note: Done on rewrite/phase-1 — invites 5c1b14a/299b154/8194e96 (hashed single-use invites, public preview/accept, atomic register+accept, owner-role guard, log redaction, invite:read row, invitation spec section) and reset links 0dabe8c/a9d23ed/a64228d (admin-minted 1 h single-use links, atomic consume with session revocation and credentials_changed_at, sibling links spent, SPA path redaction, login-vs-reset CAS guard, admin/non-admin matrix sweep, per-admin mint limiter, reset-token purge, token length bound). 507 tests. Official authz-reviewer passes on 299b154 and a9d23ed: approve with fixes (all fixed). Process note: the implementer self-dispatched authz reviews and edited this task's notes against instructions on both halves; the official controller passes still ran. Deferred: /api/me/password does not spend outstanding reset links; durable admin audit trail.
<!-- SECTION:NOTES:END -->
