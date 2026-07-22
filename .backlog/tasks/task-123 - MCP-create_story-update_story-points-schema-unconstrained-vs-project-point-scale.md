---
id: TASK-123
title: >-
  MCP create_story/update_story points schema unconstrained vs project point
  scale
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 11:00'
updated_date: '2026-07-22 16:45'
labels: []
milestone: m-2
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
- [x] #1 create_story/update_story validate points against the target project's actual point scale (pointScaleValues from packages/core), rejecting off-scale values with a clear error
- [x] #2 A test proves an off-scale points value is rejected on a fibonacci-scale project
- [x] #3 pnpm test (mcp) green
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added assertValidPoints (apps/mcp/src/handlers.ts) mirroring Web's estimateStory validation: fetches the project's point_scale/custom_points and rejects a points value not in pointScaleValues (packages/core) with a clear error, no-op for null/undefined (clearing an estimate is always valid). Wired into both create_story and update_story before any write. Verified: 3 new integration tests (create_story and update_story reject 4 on the default fibonacci-scale project; update_story still allows clearing to null) -- SUPABASE_INTEGRATION=1 suite 26 passed. tsc clean, pnpm test (mcp) green.
<!-- SECTION:FINAL_SUMMARY:END -->
