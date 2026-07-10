---
id: TASK-29
title: >-
  Chore: slim code comments per Code Comment Policy (drop history narration and
  spec restatement)
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-10 14:34'
labels:
  - web
dependencies:
  - TASK-8
priority: low
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to the Code Comment Policy added to CLAUDE.md on 2026-07-10. Existing comments in apps/web are inflated by two patterns the policy now bans: task-history narration ("TASK-19 changed this...", "this used to...") and spec restatement (paragraphs copied from spec/*.md instead of a section reference). Short constraint / why-not comments STAY — they are cross-session context this project relies on. Comment-only change: no code behavior may change. Biggest offenders by inspection: app/projects/[id]/board/actions.ts, lib/utils/iterations.ts, app/projects/[id]/settings/actions.ts, lib/utils/kanban.ts, app/projects/[id]/board/page.tsx. Depends on TASK-8 because it touches settings/actions.ts, which TASK-8 is editing in parallel.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Comments in apps/web contain no task-history narration and no spec restatement; spec references remain as section pointers only
- [ ] #2 Short constraint / why-not comments are preserved
- [ ] #3 The diff touches only comments (and doc comments) — no executable code changes
- [ ] #4 pnpm test passes unchanged
<!-- AC:END -->
