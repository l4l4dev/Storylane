---
id: TASK-109
title: 'Sidebar nav: fixed My Work link + New-project entry in the Projects switcher'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 08:05'
updated_date: '2026-07-21 10:36'
labels:
  - web
dependencies: []
priority: medium
ordinal: 10600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-12 Thread B (advisor-approved as designed). app-sidebar.tsx's single dropdown (My Work vs current project indicator + project switcher combined) splits: My Work becomes a fixed, always-visible top-level nav link (icon, highlighted when active); the existing Projects switcher stays below it (same mechanism, minus the now-redundant 'My Work' entry), gains a '+ New project' entry near 'All projects' (navigating to /dashboard?new=1, reusing TASK-104's existing inline-create-panel-pre-opened mechanism), and its trigger button grows from size='sm' to size='default'. TASK-104's 'New project' button on my-work/page.tsx is REMOVED — project creation becomes exclusively the sidebar's job. See .backlog/docs/doc-12.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 app-sidebar.tsx: My Work is a fixed top-level link (not inside the dropdown), highlighted via aria-current when on /my-work
- [x] #2 The Projects dropdown keeps its existing switcher mechanism (favorites first, then name; All projects link) minus the My Work entry, plus a new '+ New project' entry navigating to /dashboard?new=1
- [x] #3 Dropdown trigger button is size='default' (was size='sm')
- [x] #4 my-work/page.tsx's New-project button (TASK-104) is removed; TASK-104 gets a backlog comment recording this supersede
- [x] #5 app-sidebar.test.tsx updated for the fixed link, removed dropdown entry, new dropdown entry, and trigger resize
- [x] #6 spec/screens.md 'Navigation' section updated; fable-advisor design review passes; pnpm test + lint green
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Split app-sidebar.tsx's combined dropdown into a fixed, always-visible My Work top-level link (SidebarNavLink shared with the section-nav loop, aria-current when on /my-work) + the Projects switcher below it (My Work entry removed, '+ New project' entry added navigating to /dashboard?new=1, trigger size sm->default). Removed TASK-104's New-project button from my-work/page.tsx (backlog comment added recording the supersede). spec/screens.md 'Navigation' rewritten. Verified: fable-advisor design review approved (no ux-principles.md violation; minor non-blocking note on All-projects/New-project icon indentation, left as-is). /code-review (high effort, 8 finder angles + verify) found 8 issues across both this task and TASK-108's carried-over code, all fixed: a stuck-filter UX bug in MyWorkSections' 'only current iteration' toggle, an N+1 current-iteration query, a sequential-instead-of-concurrent fetch, an O(n^2) project lookup, a timezone-fragile Done-window date comparison, a CLAUDE.md reviewer-attribution comment violation, the sidebar's own duplicated nav-link styling (now the shared SidebarNavLink), and a test-coverage gap on Today's sort order (test restored). Full suite (557 unit) + tsc + lint clean.
<!-- SECTION:FINAL_SUMMARY:END -->
