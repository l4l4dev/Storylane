---
id: TASK-48
title: Implement Storylane MCP server (Phase 1 toolset)
status: In Progress
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 07:09'
updated_date: '2026-07-17 13:14'
labels:
  - mcp
  - feature
milestone: m-3
dependencies:
  - TASK-68
priority: medium
ordinal: 800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the MCP server per spec/mcp.md (TASK-47). TypeScript, monorepo package, stdio transport; agent authenticates as an ordinary project member through RLS; tools per the Phase 1 list in the spec. Includes: bot/agent profile + membership setup instructions, .env.local credential handling (never committed), unit tests for every tool's happy path and permission-denied path, and a README with Claude Code registration steps (claude mcp add). Auth/token handling is security-sensitive — assigned to Opus per model policy; run rls-security-reviewer if any migration is needed for the agent-member/PAT design.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 MCP server runs locally via stdio and registers in Claude Code
- [x] #2 All Phase 1 tools work against local Supabase as a member-role agent (RLS enforced, no service-role key)
- [x] #3 Irreversible operations are absent or confirmation-gated per spec
- [x] #4 Tests cover each tool incl. permission-denied; docs cover setup end to end
- [ ] #5 transition_story takes SELECT ... FOR UPDATE on the story row (rls-security-reviewer 2026-07-17 reproduced a lost-update race: concurrent accept/reject both succeed, last write wins silently, corrupting velocity/completed_at); regression covered
- [ ] #6 transition_story grant line revokes from public, authenticated per the TASK-55 lockdown convention (style alignment)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-07-17 implemented (Opus): apps/mcp — 10 Phase-1 tools over stdio, member-role bot via RLS, no service-role key. Handlers in src/handlers.ts (pure-ish, testable), MCP wiring in src/index.ts, auth in src/client.ts.

Two refinements vs the 2026-07-11 spec write-path rules, both from TASK-51/58 landing AFTER the TASK-47 verdict (not new design, just using current infra correctly):
- create_story: plain INSERT omitting position — stories.position now defaults to nextval(stories_position_seq) (20260716000004), which monotonically appends to the destination zone's bottom, exactly the "max(position)+1, touches no other row" intent. number is trigger-assigned.
- move_story: reuses the existing move_story_board RPC (SECURITY DEFINER, member-guarded, takes finalize+positions locks, resolves current iteration, appends to zone bottom) instead of a bare UPDATE — keeps positioning consistent with the board's own drags. Only the pre-start scheduling zones (kanban.ts evaluateDrop subset) are exposed; started+ stories change zone via transition_story.

Verified: 13 integration tests pass against local Supabase as a member-role bot (happy + permission-denied for update/transition/non-member/free-mode); MCP client handshake lists all 10 tools; tsc clean.

Still needed before fully done: (1) rls-security-reviewer pass on 20260717000004_transition_story.sql per task DoD; (2) owner creates the real bot user + `claude mcp add` (AC#1 machine registration) — smoke test used the dev user locally.

2026-07-17 rls-security-reviewer verdict on 20260717000004_transition_story.sql: PASS except (1) High — missing FOR UPDATE on the story read + no state re-check on write; live-reproduced lost update between concurrent accept/reject. Fix: add 'for update' to the SELECT at lines 42-45 (state-machine CASE then re-validates against committed state). (2) Low — revoke omits 'authenticated' (no privilege gap, style only). Everything else verified clean incl. viewer exclusion, completed_at trigger, finalize advisory-lock ordering. Codex review independently found the same race. Remaining for closure: these two fixes + owner's bot-user creation and claude mcp add (AC#1).
<!-- SECTION:NOTES:END -->
