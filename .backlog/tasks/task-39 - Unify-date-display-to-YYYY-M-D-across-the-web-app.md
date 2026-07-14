---
id: TASK-39
title: Unify date display to YYYY/M/D across the web app
status: In Progress
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-11 05:18'
updated_date: '2026-07-14 15:33'
labels:
  - web
  - ux
milestone: m-0
dependencies: []
priority: medium
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11: some places render 7/11/2026 (US order). Standardize every user-facing date to Japanese order 2026/7/11. Known call sites: apps/web/components/features/projects/project-card.tsx:107 (toLocaleDateString()), apps/web/app/projects/[id]/activity/page.tsx:46 and comment-thread.tsx:37 (toLocaleString()). Grep for any other date rendering (iteration ranges on board headers etc.). Introduce one shared formatter in apps/web/lib/utils (e.g. formatDate / formatDateTime using ja-JP or explicit y/M/d) and use it everywhere instead of bare toLocale* calls.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All visible dates render as YYYY/M/D (datetimes as YYYY/M/D HH:mm)
- [x] #2 A single shared formatter is used; no bare toLocaleDateString/toLocaleString remain in components
<!-- AC:END -->





## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow spec/ux-principles.md (landed with TASK-46) — its design-language section mandates YYYY/M/D via the shared formatter; this task implements that rule.
<!-- SECTION:NOTES:END -->
