---
id: TASK-6
title: Invite members by user search
status: Done
assignee:
  - '@l4l4dev'
created_date: '2026-07-07 14:24'
updated_date: '2026-07-10 04:38'
labels:
  - web
  - db
dependencies:
  - TASK-18
references:
  - spec/features.md
  - spec/rls.md
priority: medium
ordinal: 12500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the email input invite with a search picker over registered users, per spec/features.md 'Team Collaboration' and spec/rls.md. A capped SECURITY DEFINER RPC searches profiles by username/display_name and returns minimal columns (id, username, display_name, avatar_url). The picker is used in project settings and later in the project creation form (TASK for Projects page redesign).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Search RPC exists: min 2 chars, ilike on username/display_name, capped (e.g. 10 results), minimal columns only
- [x] #2 Project settings invite form uses the search picker with a role select; email input is removed
- [x] #3 Already-invited users are indicated/excluded in results
- [x] #4 rls-security-reviewer has reviewed the migration
- [x] #5 Tests cover the RPC (search + cap) and the picker component
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation:
- Migration 20260712000001_invite_by_user_search.sql: replaced email-based
  invite_member(uuid,text,text) with a uuid-based
  invite_member(p_project_id,p_user_id,p_role), and added
  search_users_for_invite(p_query,p_project_id) - both SECURITY DEFINER,
  owner-gated with the coalesce(project_role(...),'') pattern.
- Advisor-reviewed once (initial design), then rls-security-reviewer caught
  a real regression in a revision made mid-implementation: an early draft
  made p_project_id OPTIONAL on search_users_for_invite so TASK-7's future
  project-creation form could search before a project exists. That path's
  only gate was "signed in", which was safe when profiles had `using
  (true)` SELECT RLS - but 20260709000001_rls_hardening.sql had already
  tightened that to `id = auth.uid() or shares_project_with(id)`
  specifically to stop directory enumeration, and this function bypasses
  RLS entirely (SECURITY DEFINER). Fixed by making p_project_id required
  again; left a note on TASK-7 to design its own narrower search path
  (e.g. exact-match only) when actually implemented, rather than
  speculatively reopening this one ahead of need.
- Picker UI (invite-member-form.tsx): debounced (300ms) search box,
  results dropdown, selected-user chip with remove, role select + Invite -
  replaces the old email input entirely.
- Found and fixed a JSX whitespace bug (same class as one hit in TASK-14):
  "{displayName}\n<span>@{username}</span>" on separate JSX lines
  collapsed the space between them in the real DOM (not caught by the
  component test's accessible-name assertion until manual verification
  surfaced it) - fixed with an explicit {" "}.

Verification:
- lib/utils/invite-search.integration.test.ts (SUPABASE_INTEGRATION=1, 8
  cases): 2-char minimum, ILIKE-underscore escaping (literal vs wildcard
  match), exclusion of existing members, cap at 10, non-owner rejection,
  a nonexistent-project-id call (no membership oracle), successful invite
  + invalid-role rejection, and rejecting a nonexistent user id. All pass.
- invite-member-form.test.tsx: debounce timing, result selection, chip
  removal (component tests, RPC mocked).
- rls-security-reviewer and web-conventions-reviewer both ran; the RLS
  finding above was fixed and the migration re-verified; the conventions
  findings were a false-positive on file naming (matches existing
  kebab-case convention) and one real .then()-chain fix (applied).
- Full pnpm test/lint/tsc pass. Manually verified end-to-end in the
  browser: searched for a seeded second user, selected them, invited as
  member, confirmed they appear in the member list and are excluded from
  a repeat search.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced the email-based invite form with a debounced user-search picker backed by two SECURITY DEFINER RPCs (invite_member reworked to take a user id, plus new search_users_for_invite). A mid-implementation RLS regression (an overly permissive optional project_id path, meant to get ahead of TASK-7's needs) was caught by rls-security-reviewer and fixed by keeping the scope to what TASK-6 actually needs; a follow-up note was left on TASK-7. Verified with an 8-case DB integration test, component tests, and manual end-to-end browser testing.
<!-- SECTION:FINAL_SUMMARY:END -->
