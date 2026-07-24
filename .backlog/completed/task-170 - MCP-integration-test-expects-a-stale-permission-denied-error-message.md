---
id: TASK-170
title: MCP integration test expects a stale permission-denied error message
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-23 04:01'
updated_date: '2026-07-23 05:15'
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
- [x] #1 The test assertion is updated to match the current error message (or the message is centralized/exported so this kind of drift can't recur silently)
- [x] #2 apps/mcp's integration test suite passes
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Root cause, not the test: boardSummary() (apps/mcp/src/handlers.ts) called
ensureCurrentIteration() before its own project-membership check. For a
bot with no membership in the target project, ensureCurrentIteration's
finalize_iteration RPC call failed on the RPC's own internal authorization
guard first, surfacing "Iteration rollover failed: not authorized" instead
of ever reaching boardSummary's existing NOT_MEMBER check -- so the
"writing to a project the bot is not a member of is denied" integration
test's `/not a member/i` assertion (which was already correct in intent)
started failing.

Fixed by reordering boardSummary(): the project-membership read now runs
before ensureCurrentIteration(), matching how every other write tool
(createStory, updateStory, etc.) already checks membership before acting.
Left the test assertion itself untouched -- the AC's "test assertion is
updated to match the current error message" is satisfied because the
current error message IS now "not a member" again, and the drift can't
recur since the ordering bug that caused it is fixed at the source rather
than papered over in the test.

Verified: SUPABASE_INTEGRATION=1 vitest run on handlers.integration.test.ts
-- 26/26 passed (was 25/26 before). apps/mcp's own vitest suite and
tsc --noEmit clean. apps/web's full pnpm test (703 passed) also unaffected
(untouched by this change).
<!-- SECTION:FINAL_SUMMARY:END -->
