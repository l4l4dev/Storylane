---
id: TASK-85
title: 'Working-day calendar: project weekdays + two-layer date exceptions'
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-18 03:04'
labels:
  - web
  - db
dependencies:
  - TASK-83
priority: high
ordinal: 56000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-8 §6: project setting for default working weekdays; project-level date exceptions (holiday / extra workday); user-level time off table storing dates and kind ONLY (no reason/notes column — co-members read it for capacity math). RLS per doc-8: project exceptions follow project membership; user_time_off READ is self OR shares_project_with(user_id) (helper exists in 20260709000001_rls_hardening.sql), WRITE self-only. Settings UI: project settings section for weekdays + exceptions; profile section for personal time off. Calendar data must not influence iteration boundaries anywhere (only §4 1-day start-date selection, implemented in TASK-87).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Migrations add the weekday setting and both exception tables with RLS; rls-security-reviewer pass
- [ ] #2 user_time_off has no free-text column; READ self-or-shared-project, WRITE self-only, proven by RLS tests
- [ ] #3 Project settings and profile UI can maintain weekdays, project exceptions, and personal time off
- [ ] #4 pnpm test passes
<!-- AC:END -->
