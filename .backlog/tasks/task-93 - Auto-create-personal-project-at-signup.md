---
id: TASK-93
title: Auto-create personal project at signup
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-18 13:04'
updated_date: '2026-07-19 06:29'
labels:
  - web
  - db
milestone: m-5
dependencies:
  - TASK-87
  - TASK-91
priority: medium
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-8 §4 owner decision 2026-07-18: on signup, auto-create a personal project for the new user (1-day cadence, minimal state template, name like "My Tasks") so a solo user manages their own tasks with zero setup and no team project. Reuse the create_project RPC/template seeding from TASK-91; spec addendum to spec/screens.md (onboarding) and spec/features.md as part of this task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A fresh signup lands with one personal project (1-day cadence, minimal template) already present; My Work works immediately
- [ ] #2 Spec updated (screens onboarding + features)
- [ ] #3 pnpm test passes
<!-- AC:END -->
