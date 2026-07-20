---
id: TASK-101
title: >-
  MCP board_summary: compatibility window for the velocity to velocity_rate
  rename
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-20 03:14'
labels:
  - web
milestone: m-5
dependencies:
  - TASK-86
priority: low
ordinal: 11300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-86 renamed board_summary's 'velocity' field to 'velocity_rate' with no transition period, and changed its meaning from a per-sprint point total to a fraction that is usually below 1.

Why it matters: an agent (or a saved prompt/workflow) reading summary.velocity now gets undefined rather than an error, so any arithmetic on it yields NaN — a silent wrong answer instead of a loud failure. A consumer that merely renames the key still misreads the value if it kept the old 'pts' wording.

Options to weigh: emit both keys for one release with the old one documented as deprecated, or rename to something self-describing such as velocity_points_per_person_day so a stale consumer cannot mistake the units. Check whether any agent config in this repo or the owner's setup reads the old key before choosing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A stale consumer of the old field either keeps working or fails loudly — never silently produces NaN
- [ ] #2 spec/mcp.md and apps/mcp/README.md describe the field's units unambiguously
<!-- AC:END -->
