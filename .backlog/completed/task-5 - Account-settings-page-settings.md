---
id: TASK-5
title: Account settings page (/settings)
status: Done
assignee:
  - '@l4l4dev'
created_date: '2026-07-07 14:24'
updated_date: '2026-07-10 04:13'
labels:
  - web
dependencies: []
references:
  - spec/screens.md
priority: medium
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Profile identity (username, display name) is edited on a dedicated account settings page, not on the Projects page and not per project. See spec/screens.md route map. Avatar upload stays Phase 2 (avatar_url comes from OAuth).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /settings page exists with username and display name editing (reusing the existing updateUsername action pattern)
- [x] #2 UsernameEditor is removed from /dashboard
- [x] #3 Sidebar account menu links to /settings
- [x] #4 Component tests cover the settings form (success and validation error)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation:
- New /settings page (app/settings/page.tsx) + updateProfile action
  (app/settings/actions.ts) editing both display_name and username in one
  submit (profiles RLS already permits self-update of both columns, no
  migration needed).
- ProfileSettingsForm (components/features/settings/) replaces the old
  UsernameEditor — deleted username-editor.tsx/.test.tsx and the old
  updateUsername action/UpdateUsernameState from dashboard/actions.ts,
  no longer used anywhere.
- Dashboard header gained an "Account settings" button (spec/screens.md
  line 13-14: reached from "the Projects page header" too, not just the
  sidebar) alongside the existing sidebar account-menu entry (AC#3).

Verification:
- profile-settings-form.test.tsx: pre-fill, success message, and
  server-side validation error message (mocked action) - AC#4.
- web-conventions-reviewer ran clean (one false-positive naming note,
  matches existing kebab-case convention repo-wide, not changed).
- Full pnpm test/lint/tsc pass. Manually verified in the browser: both
  entry points (dashboard header button, sidebar account menu) navigate to
  /settings; editing display name persists and shows "Saved."; dashboard
  no longer shows the inline username row.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a dedicated /settings page for username/display-name editing, reached from both the dashboard header and the sidebar account menu, replacing the old inline UsernameEditor on /dashboard. Verified with component tests (success + validation error) and manual browser testing.
<!-- SECTION:FINAL_SUMMARY:END -->
