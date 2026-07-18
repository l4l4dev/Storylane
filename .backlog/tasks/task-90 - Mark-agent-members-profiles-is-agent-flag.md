---
id: TASK-90
title: 'Mark agent members: profiles is-agent flag'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-18 03:05'
labels:
  - web
  - db
dependencies:
  - TASK-83
priority: medium
ordinal: 61000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-8 §8. Add an is-agent boolean to profiles (default false) so UIs can tell agent members from humans; set it on the existing bot profile (spec/mcp.md agent-as-member). Show a small agent indicator wherever members render (member list, assignee chips, activity). Capacity math (TASK-86) treats agents like humans via the same calendar; no exclude-AI toggle in v1; no per-user weekday patterns (deferred).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 profiles carries the flag; bot profile flagged; RLS unchanged and re-verified
- [ ] #2 Member list and assignee UI show an agent indicator
- [ ] #3 pnpm test passes
<!-- AC:END -->
