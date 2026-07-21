---
id: TASK-109
title: 'Sidebar nav: fixed My Work link + New-project entry in the Projects switcher'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 08:05'
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
- [ ] #1 app-sidebar.tsx: My Work is a fixed top-level link (not inside the dropdown), highlighted via aria-current when on /my-work
- [ ] #2 The Projects dropdown keeps its existing switcher mechanism (favorites first, then name; All projects link) minus the My Work entry, plus a new '+ New project' entry navigating to /dashboard?new=1
- [ ] #3 Dropdown trigger button is size='default' (was size='sm')
- [ ] #4 my-work/page.tsx's New-project button (TASK-104) is removed; TASK-104 gets a backlog comment recording this supersede
- [ ] #5 app-sidebar.test.tsx updated for the fixed link, removed dropdown entry, new dropdown entry, and trigger resize
- [ ] #6 spec/screens.md 'Navigation' section updated; fable-advisor design review passes; pnpm test + lint green
<!-- AC:END -->
