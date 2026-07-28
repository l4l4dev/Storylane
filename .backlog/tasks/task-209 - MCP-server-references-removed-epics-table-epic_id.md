---
id: TASK-209
title: MCP server references removed epics table/epic_id
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-27 06:08'
labels: []
milestone: m-3
dependencies: []
references:
  - apps/mcp/src/handlers.ts
  - apps/mcp/src/index.ts
  - supabase/migrations/20260724051506_epic_story_unification_rpcs.sql
priority: high
type: bug
ordinal: 1275
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MCP handlers.ts and index.ts still reference the epics table, epic_id, and p_epic_id, which doc-18 removed in favor of stories.parent_id (current RPC: supabase/migrations/20260724051506_epic_story_unification_rpcs.sql). MCP integration tests fail 20/29 as a result, covering list_stories, get_story, create_story, parent/child updates, and move operations. Unit tests mock the old API so they don't catch this, and the integration suite is skipped in normal runs. Found via Codex external review, 2026-07-27.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 MCP list_stories, get_story, create_story, and move/reparent handlers use parent_id instead of epic_id/epics
- [ ] #2 MCP integration test suite passes with SUPABASE_INTEGRATION=1
- [ ] #3 index.ts tool schemas no longer expose epic_id as an input field
<!-- AC:END -->
