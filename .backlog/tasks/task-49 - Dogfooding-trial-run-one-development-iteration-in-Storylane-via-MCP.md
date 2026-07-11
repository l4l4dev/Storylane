---
id: TASK-49
title: 'Dogfooding trial: run one development iteration in Storylane via MCP'
status: To Do
assignee:
  - '@l4l4dev'
created_date: '2026-07-11 07:10'
updated_date: '2026-07-11 17:26'
labels:
  - mcp
  - process
milestone: m-3
dependencies:
  - TASK-48
  - TASK-3
priority: medium
ordinal: 15600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parallel-run trial after the MCP server lands: mirror the then-current development tasks into a Storylane project (tracker mode) and run one full iteration managing them there via MCP from Claude Code, while Backlog.md stays the source of truth. Log every friction point (missing tool, awkward flow, field mismatch — e.g. acceptance criteria vs story checklist) as candidate follow-up tasks. At iteration end, decide with the owner: switch task management to Storylane, extend the trial, or stay on Backlog.md. Requires the 2026-07-11 UX batch and deploy (TASK-3) to be done so the board is actually usable day-to-day.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A Storylane project mirrors the active dev tasks and one iteration is completed through it via MCP
- [ ] #2 Friction log exists with each item triaged (task created / dismissed)
- [ ] #3 Go/no-go decision on switching from Backlog.md is recorded
<!-- AC:END -->
