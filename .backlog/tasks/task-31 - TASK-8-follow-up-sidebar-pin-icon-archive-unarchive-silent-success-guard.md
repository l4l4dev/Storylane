---
id: TASK-31
title: 'TASK-8 follow-up: sidebar pin icon + archive/unarchive silent-success guard'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-10 23:33'
labels:
  - web
dependencies: []
priority: low
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two non-blocking findings from fable-advisor's PR #4 review (TASK-8 project archive/favorites/search/sort), left unfixed at merge time:
1. spec/screens.md 'Project switcher' section says the dropdown lists favorites first 'with a pin icon' — TASK-8 implemented the favorites-first sort but never added the pin icon itself to app-sidebar.tsx's dropdown items.
2. archiveProject/unarchiveProject (apps/web/app/dashboard/actions.ts) don't check whether the UPDATE actually affected a row. If a non-owner's request reaches the action (forged POST, or stale client state), Supabase RLS silently filters the row and returns no error — the action reports success even though nothing changed. Low real-world impact since the UI only ever shows the controls to owners, but doesn't match TASK-25's 'surface RPC/DB errors, don't swallow them' precedent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Sidebar project switcher shows a pin icon next to favorited projects in the dropdown, matching spec/screens.md
- [ ] #2 archiveProject/unarchiveProject check the updated row count (e.g. .select('id') after .update()) and throw if empty, instead of silently succeeding
- [ ] #3 Tests cover both
<!-- AC:END -->
