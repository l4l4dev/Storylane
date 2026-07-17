---
id: TASK-25
title: >-
  Fix TASK-7 follow-up: velocity_window validation, invite_failed guard, picker
  cap, RPC error surfacing
status: Done
assignee:
  - '@l4l4dev'
created_date: '2026-07-10 10:00'
updated_date: '2026-07-10 10:12'
labels:
  - web
  - db
dependencies: []
priority: medium
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up from PR #2 (TASK-7 projects-page-redesign) fable-advisor final review, found after merge (see PR #2 comment). Four small, related hardening fixes in the project-creation/invite path:
1. projects.velocity_window has no DB CHECK constraint and no validation in createProject/settings actions — 0, negative, or huge values are accepted (0 makes velocity permanently display as 0).
2. /dashboard?invite_failed=<value> is rendered into the banner text without a numeric guard — a crafted query param shows a nonsensical message (not an XSS risk, React escapes it, but should still validate).
3. NewProjectInvitePicker has no client-side cap matching createProject's server-side 20-invite cap — a user adding 21+ chips gets silently truncated server-side with no feedback.
4. searchUserForNewProject (apps/web/app/dashboard/actions.ts) swallows the RPC's error and returns null on any failure, so a transient error is indistinguishable from a genuine not-found in the UI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 projects.velocity_window has a DB CHECK constraint (e.g. between 1 and a reasonable upper bound); a migration adds it and is reviewed by rls-security-reviewer
- [x] #2 createProject and updateProject (settings/actions.ts) clamp/validate velocity_window before insert/update instead of passing it through raw
- [x] #3 /dashboard's invite_failed banner only renders for a valid positive integer query param
- [x] #4 NewProjectInvitePicker enforces the same 20-user cap client-side with a visible message when reached
- [x] #5 searchUserForNewProject distinguishes an RPC error from a genuine not-found result and the picker surfaces the difference to the user
- [x] #6 Tests cover all four fixes
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
velocity_window に DB CHECK(>=1)+clampVelocityWindow()、invite_failed の数値ガード、招待ピッカーのクライアント側20人上限、searchUserForNewProjectのfound/not_found/error判別を追加。rls-security-reviewer指摘なし、テスト307件パス。PR #3としてマージ済み。
<!-- SECTION:FINAL_SUMMARY:END -->
