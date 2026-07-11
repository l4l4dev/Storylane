---
id: TASK-47
title: 'Spec & design: Storylane MCP server + agent-as-member model'
status: To Do
assignee:
  - '@claude-fable-5'
created_date: '2026-07-11 07:09'
labels:
  - mcp
  - design
dependencies: []
priority: medium
ordinal: 15200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Direction decided by the owner 2026-07-11 (AI-friendly option A + dogfooding goal): build an MCP server so coding agents (Claude Code etc.) can read/write Storylane projects, with the end goal of managing Storylane's own development tasks in Storylane instead of Backlog.md.

Deliverable of THIS task is design, not code: a new spec/mcp.md covering
- Placement: TypeScript MCP server in the monorepo (apps/mcp or packages/mcp), stdio transport for local agent use.
- Agent-as-member model: agents are ordinary project_members (own profile, role 'member'), no service-role bypass; all access flows through existing RLS and sanctioned write paths (RPCs like finalize_iteration/promote_story_to_epic; never direct activity_logs writes — see ARCHITECTURE.md coupling table).
- Auth: how an agent obtains/stores credentials (.env.local; refresh-token or PAT approach — design the options, pick one with rationale). This is the security-sensitive core.
- Phase 1 toolset: board summary (current iteration, points, velocity), story list/get/create/update, lifecycle transitions, move between iteration/backlog/icebox, comments, story tasks (checklist). Irreversible ops (finish iteration, delete) excluded or confirmation-gated in Phase 1.
- Backlog.md migration path: one parallel-run iteration (Backlog.md as source of truth, mirrored to Storylane) before switching.

MANDATORY: /advisor review of the design before marking done. Update SPEC.md index.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 spec/mcp.md exists covering placement, agent-member model, auth design with rationale, Phase 1 toolset, and migration path
- [ ] #2 Design has an advisor (fable-advisor) verdict recorded in this task
- [ ] #3 SPEC.md index references spec/mcp.md
<!-- AC:END -->
