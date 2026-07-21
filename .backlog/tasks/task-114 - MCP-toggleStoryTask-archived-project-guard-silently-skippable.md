---
id: TASK-114
title: 'MCP toggleStoryTask: archived-project guard silently skippable'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 10:59'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 11100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 finding #6. apps/mcp/src/handlers.ts:638 (toggleStoryTask) only calls assertWritableProject if projectId is truthy, unlike every other MCP write tool which asserts unconditionally — if the stories(project_id) embed ever resolves null, the archived-project check is silently bypassed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 toggleStoryTask fails closed (throws) if the stories(project_id) embed resolves null, matching every sibling MCP write tool's unconditional assertWritableProject call
- [ ] #2 A test proves the archived-project guard can't be bypassed
- [ ] #3 pnpm test (mcp) green
<!-- AC:END -->
