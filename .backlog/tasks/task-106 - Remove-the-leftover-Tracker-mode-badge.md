---
id: TASK-106
title: Remove the leftover Tracker mode badge
status: To Do
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-21 06:00'
labels:
  - web
dependencies: []
priority: low
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-11 D4. The <Badge>Tracker</Badge> in project-card.tsx and the sidebar mode-badge are leftovers from the removed Tracker/Free workflow_mode split (doc-8 single mode). Remove them; no replacement (single mode, and after TASK-103 the projects list holds only team projects). See .backlog/docs/doc-11.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The Tracker <Badge> is removed from project-card.tsx and the mode-badge from app-sidebar.tsx; the light/dark ModeToggle in app-sidebar (unrelated, same 'mode' word) is NOT touched
- [ ] #2 project-card.test.tsx and any app-sidebar test asserting the Tracker badge are updated; pnpm test + lint green
<!-- AC:END -->
