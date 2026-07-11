---
id: TASK-48
title: Implement Storylane MCP server (Phase 1 toolset)
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 07:09'
labels:
  - mcp
  - feature
dependencies:
  - TASK-47
priority: medium
ordinal: 15400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the MCP server per spec/mcp.md (TASK-47). TypeScript, monorepo package, stdio transport; agent authenticates as an ordinary project member through RLS; tools per the Phase 1 list in the spec. Includes: bot/agent profile + membership setup instructions, .env.local credential handling (never committed), unit tests for every tool's happy path and permission-denied path, and a README with Claude Code registration steps (claude mcp add). Auth/token handling is security-sensitive — assigned to Opus per model policy; run rls-security-reviewer if any migration is needed for the agent-member/PAT design.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 MCP server runs locally via stdio and registers in Claude Code
- [ ] #2 All Phase 1 tools work against local Supabase as a member-role agent (RLS enforced, no service-role key)
- [ ] #3 Irreversible operations are absent or confirmation-gated per spec
- [ ] #4 Tests cover each tool incl. permission-denied; docs cover setup end to end
<!-- AC:END -->
