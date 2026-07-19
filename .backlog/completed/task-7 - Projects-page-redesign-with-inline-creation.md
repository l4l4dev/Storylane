---
id: TASK-7
title: Projects page redesign with inline creation
status: Done
assignee:
  - '@l4l4dev'
created_date: '2026-07-07 14:25'
updated_date: '2026-07-10 06:04'
labels:
  - web
milestone: m-0
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
- [x] #1 New project creation happens in an inline panel on /dashboard; create-project-dialog overlay is removed
- [x] #2 Mode is chosen via comparison cards; Tracker shows iteration length / point scale / velocity window fields, Free shows column template choice (KanbanFlow / Basic per spec)
- [x] #3 Members can be invited from the creation panel (optional) using the user-search picker
- [x] #4 Project cards show mode badge, mode-specific summary line, overlapping member avatars capped with +N, and last-updated time
- [x] #5 Page uses the same design tokens/card styles as project pages (visual unification)
- [x] #6 Tests cover the creation form (both modes) and card rendering
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
See docs/superpowers/plans/2026-07-10-projects-page-redesign.md (9 tasks: search_users_for_new_project RPC, action wrapper, NewProjectInvitePicker, createProject invite extension, ModeComparisonCard, ProjectCard, InlineCreatePanel replacing CreateProjectDialog, dashboard page rewrite, review gates + finalization). fable-advisor reviewed the RPC design 2026-07-10 (approved with changes, folded into the plan).
<!-- SECTION:PLAN:END -->

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

Implemented per docs/superpowers/plans/2026-07-10-projects-page-redesign.md via subagent-driven-development on branch feat/projects-page-redesign (9 tasks, all task-reviewer-approved):
- New search_users_for_new_project RPC (exact-match, case-insensitive, self-excluding, signed-in-gated) backing a pre-project invite picker, since the existing search_users_for_invite requires an owner-gated project_id and can't be reused before a project exists (per TASK-6's rls-security-reviewer finding). fable-advisor reviewed the RPC design 2026-07-10 (approved with changes: self-exclusion added, format validation added, createProject dedupe/cap/failure-surfacing added).
- NewProjectInvitePicker, ModeComparisonCard, ProjectCard, InlineCreatePanel (replaces CreateProjectDialog) components.
- createProject extended: reads invited_user_ids, dedupes, excludes the caller's own id (defense in depth against invite_member's upsert demoting the creator's own owner row), caps at 20, invites best-effort without rolling back project creation, surfaces failures via ?invite_failed=<count>.
- Dashboard page rewritten: per-project velocity/current-iteration (tracker) or column/open-card counts (free), calling ensureCurrentIteration for lazy rollover consistent with the board page, member avatars, grid layout.
- rls-security-reviewer verified the new migration live against a local DB reset (exact-match, self-exclusion, format-guard, auth-gate all held; no blocking findings). web-conventions-reviewer ran lint+typecheck clean, no convention violations.
- Full suite: 297 passed, 0 failed (33 skipped integration tests requiring SUPABASE_INTEGRATION=1).
- Manually verified end-to-end in the browser: inline panel expands with no dialog role, mode switch swaps Tracker/Free fields correctly, created a Tracker project (shows "Iteration #1 · velocity 0 pts") and a Free/KanbanFlow project (shows "5 columns · 0 open cards"), invite picker's not-found message for a nonexistent username. Test projects cleaned up by id afterward.
- spec/screens.md updated to describe the exact-match picker instead of the (inapplicable) fuzzy picker.

Final whole-branch review (opus, post-implementation): Ready to merge. One Important finding fixed before merge — Promise.all over ensureCurrentIteration across all tracker projects would 500 the whole dashboard if even one project's iteration rollover failed; fixed with a rolloverIterationSafely() wrapper + 2 unit tests (commit 3300feb). Minor/cosmetic notes not requiring a fix: no client-side cap on invite picker beyond the server's 20 (silent drop past 20, edge case), no server-side clamp on velocity_window beyond the client min=1, invite_failed query param rendered without a numeric guard, mode-comparison-card hover ring has no width, dead setState calls after createProject's redirect (harmless, inherited from the old dialog), and the per-card Settings link was intentionally dropped (TASK-8 owns card overflow menus).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Rebuilt /dashboard: inline creation panel (no overlay), Tracker/Free comparison cards, optional initial invites via a new exact-match RPC, and redesigned project cards with mode badge/summary/avatars/last-updated. Implemented across 9 reviewed subagent-driven tasks on feat/projects-page-redesign; rls-security-reviewer and web-conventions-reviewer both passed; full suite green; manually verified in-browser.
<!-- SECTION:FINAL_SUMMARY:END -->
