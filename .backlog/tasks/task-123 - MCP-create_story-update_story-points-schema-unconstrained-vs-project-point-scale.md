---
id: TASK-123
title: >-
  MCP create_story/update_story points schema unconstrained vs project point
  scale
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 11:00'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 finding #15. apps/mcp/src/index.ts:88 accepts any points >= 0 with no check against the project's configured point scale (fibonacci/linear/custom), even though packages/core already exports pointScaleValues() for this — an agent can land an off-scale value the Web UI's point picker can never produce.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 create_story/update_story validate points against the target project's actual point scale (pointScaleValues from packages/core), rejecting off-scale values with a clear error
- [ ] #2 A test proves an off-scale points value is rejected on a fibonacci-scale project
- [ ] #3 pnpm test (mcp) green
<!-- AC:END -->
