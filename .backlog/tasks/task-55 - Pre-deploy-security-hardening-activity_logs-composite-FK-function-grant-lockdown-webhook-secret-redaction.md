---
id: TASK-55
title: >-
  Pre-deploy security hardening: activity_logs composite FK, function grant
  lockdown, webhook secret redaction
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 16:11'
updated_date: '2026-07-11 17:26'
labels:
  - security
  - rls
  - db
milestone: m-1
dependencies: []
priority: high
ordinal: 14600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex full-codebase review (2026-07-12), Medium/Low security bundle — do before TASK-3 deploy:
1. activity_logs (20260627000006_comments_activity.sql): project_id and story_id are independent FKs, so a member can insert a log in project A referencing project B's story. Add composite FK (story_id, project_id) → stories(id, project_id) and restrict direct INSERT to the trigger/RPC paths (clients never insert activity_logs — ARCHITECTURE.md rule, now enforced in DB).
2. Grants (20260630000002_grants.sql): default EXECUTE to authenticated on ALL current+future public functions means every future SECURITY DEFINER helper ships remotely callable. Revoke the blanket/default grant; grant EXECUTE explicitly per intended RPC; revoke from trigger/internal helpers.
3. integrations.webhook_secret is readable via the owner SELECT policy and flows to the browser. Move secrets to a service-only surface or a redacted view/RPC that never returns the secret after creation; settings UI shows set/rotate only.
Migration-heavy — run rls-security-reviewer; verify the MCP design (spec/mcp.md) still works under the tightened grants (its RPCs must be explicitly granted).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Cross-project story references in activity_logs are impossible (composite FK) and direct client INSERT is denied
- [ ] #2 Only intended RPC entry points are executable by authenticated; new functions are private by default
- [ ] #3 webhook_secret is never returned to any client query after creation
- [ ] #4 rls-security-reviewer passes; existing web flows and finalize_iteration/invite_member RPCs still work under the new grants
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Full Codex report: backlog doc-1 (.backlog/docs/reviews/) — read the matching finding before implementing.
<!-- SECTION:NOTES:END -->
