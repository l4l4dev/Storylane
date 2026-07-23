---
id: TASK-170
title: MCP integration test expects a stale permission-denied error message
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-23 04:01'
labels: []
milestone: m-3
dependencies: []
priority: low
type: bug
ordinal: 1275
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex review (2026-07-23) found apps/mcp/src/handlers.integration.test.ts:466 asserts an error message string that no longer matches the current implementation's wording, failing the MCP integration suite.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The test assertion is updated to match the current error message (or the message is centralized/exported so this kind of drift can't recur silently)
- [ ] #2 apps/mcp's integration test suite passes
<!-- AC:END -->
