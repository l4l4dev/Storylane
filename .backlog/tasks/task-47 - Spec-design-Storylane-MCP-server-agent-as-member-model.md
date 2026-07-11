---
id: TASK-47
title: 'Spec & design: Storylane MCP server + agent-as-member model'
status: Done
assignee:
  - '@claude-fable-5'
created_date: '2026-07-11 07:09'
updated_date: '2026-07-11 07:51'
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
- [x] #1 spec/mcp.md exists covering placement, agent-member model, auth design with rationale, Phase 1 toolset, and migration path
- [x] #2 Design has an advisor (fable-advisor) verdict recorded in this task
- [x] #3 SPEC.md index references spec/mcp.md
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read ARCHITECTURE.md relations + spec/rls.md auth surface for constraints
2. Write spec/mcp.md (placement, agent-as-member, auth options + decision, Phase 1 tools, migration)
3. Add SPEC.md index row
4. /advisor review, record verdict
5. Finalize
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
ADVISOR VERDICT (fable-advisor, 2026-07-11): approved with corrections — all applied to spec/mcp.md. Key findings: (1) unestimated-feature guard + TASK-19 current-iteration assignment exist ONLY in the Web server action, so transition_story must be a new Postgres RPC (done-iteration trigger unchanged); Web transitionStory switches to it in a follow-up task. (2) Member-role RLS makes writes to non-authored/non-assigned stories silent 0-row no-ops — every write tool verifies affected rows and errors explicitly; agent-managed stories are agent-created/assigned; bot stays 'member'. (3) Tools touching the current iteration call finalize_iteration(p_manual:false) first via one shared helper (lazy rollover obligation). (4) backlog_top and move_story position dropped from Phase 1 (member bot cannot resequence other rows — TASK-20-class corruption risk); zone-bottom landing only. (5) Slack notifications will not fire for agent-driven changes until TASK-24 — documented, no notifySlack duplication. Minor: workflow_mode + archived_at guards in write tools; update_story is partial field UPDATE; pure logic shared via packages/core. Question 'can dogfooding run without finalize_iteration tool' answered: yes, lazy rollover suffices once (3) is in.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wrote spec/mcp.md (agent-as-member model, password-auth decision with rejected alternatives, Phase 1 toolset, migration path), revised per fable-advisor verdict (approved with corrections): transition_story becomes a Postgres RPC, row-count verification on all writes, shared lazy-rollover helper, mode/archive guards, no backlog_top/position, Slack gap documented, packages/core extraction. Verdict recorded in notes; SPEC.md indexed; follow-up TASK-50 registered; TASK-48 annotated with binding implementer instructions.
<!-- SECTION:FINAL_SUMMARY:END -->
