---
id: TASK-92
title: Record app run recipe to enable /verify
status: To Do
assignee:
  - '@l4l4dev'
created_date: '2026-07-18 03:28'
labels:
  - tooling
dependencies: []
priority: low
ordinal: 63000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Run /run-skill-generator once with the local stack available (supabase start + pnpm dev) so the build/launch recipe is recorded as a project run skill under .claude/skills/. After that, implementation sessions can end with /verify to drive the affected flow end-to-end before handing over for manual verification. Zero code changes; one interactive session.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A run skill exists under .claude/skills/ and /run launches the app with it
- [ ] #2 /verify successfully drives a trivial change end-to-end using the recipe
<!-- AC:END -->
