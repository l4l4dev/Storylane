---
id: TASK-114
title: 'MCP toggleStoryTask: archived-project guard silently skippable'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 10:59'
updated_date: '2026-07-21 13:30'
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
- [x] #1 toggleStoryTask fails closed (throws) if the stories(project_id) embed resolves null, matching every sibling MCP write tool's unconditional assertWritableProject call
- [x] #2 A test proves the archived-project guard can't be bypassed
- [x] #3 pnpm test (mcp) green
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. apps/mcp/src/handlers.ts toggleStoryTask: change the conditional 'if (projectId) await assertWritableProject(...)' to fail closed -- throw NOT_MEMBER when the stories(project_id) embed resolves null, then call assertWritableProject unconditionally, matching every sibling MCP write tool.
2. Add apps/mcp/src/handlers.test.ts (new, mocked-client unit test -- the existing handlers.integration.test.ts needs a live 'supabase start' and can't provoke a null stories embed since tasks/stories SELECT RLS share the same membership check) proving: (a) null embed -> throws not-a-member, (b) archived project -> throws archived error, (c) writable project -> succeeds.
3. Run pnpm test (mcp) and tsc --noEmit.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fix: apps/mcp/src/handlers.ts:646-648 now throws NOT_MEMBER if the stories(project_id) embed is null before calling assertWritableProject unconditionally. Test: new apps/mcp/src/handlers.test.ts (mocked Supabase client, no live DB needed) covers null-embed fail-closed, archived-project rejection, and the writable-project success path. Verified: pnpm exec vitest run src/handlers.test.ts (3/3 pass), pnpm test (3 passed, 23 skipped -- the live-DB integration suite skips without SUPABASE_INTEGRATION=1), pnpm exec tsc --noEmit clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
toggleStoryTask now fails closed instead of silently skipping the archived-project guard when the stories(project_id) embed resolves null, matching every other MCP write tool's unconditional assertWritableProject call. Verified via a new mocked-client test (apps/mcp/src/handlers.test.ts, 3/3 pass) plus pnpm test and tsc --noEmit, both clean.
<!-- SECTION:FINAL_SUMMARY:END -->
