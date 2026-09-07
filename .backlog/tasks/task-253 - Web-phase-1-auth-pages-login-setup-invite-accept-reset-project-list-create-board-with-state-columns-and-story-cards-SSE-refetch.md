---
id: TASK-253
title: >-
  Web phase 1: auth pages (login, setup, invite accept, reset), project
  list/create, board with state columns and story cards, SSE refetch
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-07 02:55'
labels: []
milestone: m-9
dependencies:
  - TASK-248
  - TASK-250
  - TASK-251
  - TASK-252
references:
  - docs/design/2026-09-05-self-host-rewrite-design.md
  - spec/ux-principles.md
  - spec/screens.md
priority: high
type: feature
ordinal: 900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SPA screens for the vertical slice on top of the phase-1 API: login/logout, /setup, invite accept, reset; project list + create; board page with state columns, story cards (title, number, estimate), quick-add, drag to reorder/move between columns (dnd-kit), transition controls per spec/screens.md 'Board layout' basics; SSE-driven refetch. Follow spec/ux-principles.md (check original Pivotal Tracker behaviour for tracker interactions) and end with the fable-advisor design review per CLAUDE.md. Reuse shadcn/Tailwind tokens from v0-supabase where they fit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A new user can: open /setup, create the admin, create a project, add stories, drag a story to another column and see completed_at behaviour, in the browser against a local server
- [ ] #2 Component tests for the board reducer/ordering logic and the auth forms; vitest green; lint green
- [ ] #3 fable-advisor design review verdict recorded in notes
<!-- AC:END -->
