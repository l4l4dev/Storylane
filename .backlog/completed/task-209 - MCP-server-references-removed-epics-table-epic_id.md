---
id: TASK-209
title: MCP server references removed epics table/epic_id
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-27 06:08'
updated_date: '2026-07-28 01:09'
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
- [x] #1 MCP list_stories, get_story, create_story, and move/reparent handlers use parent_id instead of epic_id/epics
- [x] #2 MCP integration test suite passes with SUPABASE_INTEGRATION=1
- [x] #3 index.ts tool schemas no longer expose epic_id as an input field
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed handlers.ts/index.ts to use stories.parent_id/is_container instead of the dropped epics table/epic_id, matching create_story_tracker's p_parent_id param (20260724051506) and spec/mcp.md's tool contracts. Also fixed moveStory's move_story_board call, which didn't include parent_id in p_expected — that RPC (20260724153129_move_story_board_parent_delta.sql) now hard-requires the key and was failing 'move_story reschedules an unstarted story to a zone bottom' with 'p_expected.parent_id is required'; this wasn't named in the task's epic_id description but is the same parent_id-migration gap and blocked AC #2. Updated the one integration test still calling create_story_tracker directly with p_epic_id. Updated apps/mcp/README.md's list_stories row (epic -> parent). Verified: tsc --noEmit clean, full vitest suite (unit+integration, SUPABASE_INTEGRATION=1) 29/29 passing against local Supabase. Repo-wide grep confirms no remaining epic_id/p_epic_id references outside generated database.types.ts.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
MCP handlers.ts/index.ts re-anchored from the dropped epics table/epic_id onto stories.parent_id/is_container (doc-18), matching create_story_tracker's p_parent_id and spec/mcp.md. Also fixed moveStory's move_story_board call to include parent_id in p_expected, which the RPC now requires. Verified with the full MCP vitest suite (29/29, SUPABASE_INTEGRATION=1) against local Supabase.
<!-- SECTION:FINAL_SUMMARY:END -->
