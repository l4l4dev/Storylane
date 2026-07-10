---
id: TASK-7
title: Projects page redesign with inline creation
status: To Do
assignee: []
created_date: '2026-07-07 14:25'
updated_date: '2026-07-10 04:33'
labels:
  - web
dependencies:
  - TASK-5
  - TASK-6
references:
  - spec/screens.md
priority: high
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rebuild /dashboard per spec/screens.md 'Projects page': inline creation panel (no overlay dialog), mode selection as Tracker/Free comparison cards, all initial settings in the form (iteration length, point scale, velocity window / free column template), optional initial member invites via the user-search picker, and project cards with mode badge, mode-specific summary, member avatars, and last-updated. Design language unified with the project pages.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 New project creation happens in an inline panel on /dashboard; create-project-dialog overlay is removed
- [ ] #2 Mode is chosen via comparison cards; Tracker shows iteration length / point scale / velocity window fields, Free shows column template choice (KanbanFlow / Basic per spec)
- [ ] #3 Members can be invited from the creation panel (optional) using the user-search picker
- [ ] #4 Project cards show mode badge, mode-specific summary line, overlapping member avatars capped with +N, and last-updated time
- [ ] #5 Page uses the same design tokens/card styles as project pages (visual unification)
- [ ] #6 Tests cover the creation form (both modes) and card rendering
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow-up from TASK-6 (Invite by user search): search_users_for_invite(p_query, p_project_id)
now requires p_project_id (owner-gated, excludes existing members) - an
earlier draft made it optional for this task's project-creation-form use
case (searching before a project exists), but rls-security-reviewer found
that the optional path reopened a directory-enumeration hole that
20260709000001_rls_hardening.sql had specifically closed (profiles RLS is
`id = auth.uid() or shares_project_with(id)`, not `using (true)` anymore -
and SECURITY DEFINER bypasses RLS entirely, so the only gate left was
"signed in"). If this task's creation panel needs to search for initial
members before the project row exists, design a new, separately-reviewed
path for it (e.g. exact-username-match only, no fuzzy ILIKE) rather than
reopening the general fuzzy-search RPC to unscoped callers.
<!-- SECTION:NOTES:END -->
