---
id: TASK-101
title: >-
  MCP board_summary: compatibility window for the velocity to velocity_rate
  rename
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-20 03:14'
updated_date: '2026-07-21 10:07'
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
- [x] #1 A stale consumer of the old field either keeps working or fails loudly — never silently produces NaN
- [x] #2 spec/mcp.md and apps/mcp/README.md describe the field's units unambiguously
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Renamed board_summary's velocity_rate to velocity_points_per_person_day (apps/mcp/src/handlers.ts, index.ts tool description). Confirmed with owner: no consumer inside this repo or the owner's external setup reads either old key ('velocity' or 'velocity_rate'), so no compatibility shim was needed — a maximally self-describing name was chosen over a dual-key transition window per the task's own reasoning (a stale reader could only ever misinterpret a compatibility value, never correctly reuse it). Units spelled out unambiguously in spec/mcp.md and apps/mcp/README.md with an example value. Verified: MCP typecheck clean, 23 integration tests pass (1 updated), full web suite (535 unit) unaffected (board_summary isn't called from apps/web).
<!-- SECTION:FINAL_SUMMARY:END -->
