---
id: TASK-55
title: >-
  Pre-deploy security hardening: activity_logs composite FK, function grant
  lockdown, webhook secret redaction
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 16:11'
updated_date: '2026-07-11 19:33'
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

DESIGN (Fable, 2026-07-12 — treat as the advisor-approved design):
GRANT LOCKDOWN (20260630000002_grants.sql lines 14-15, 22-23 are the target):
- revoke execute on all functions in schema public from authenticated; drop the 'alter default privileges ... grant execute on functions' rule. New functions become private by default.
- Re-grant EXECUTE explicitly to authenticated ONLY for intended entry points: invite_member, finalize_iteration, promote_story_to_epic, move_story_to_project, copy_story_to_project, plus the RPCs landing from TASK-48/50/53/54/56 as they merge (each new RPC migration carries its own grant line from now on).
- ⚠️ TRAP: functions referenced inside RLS policies (project_role, is_project_member) are executed by the querying role and MUST KEEP EXECUTE for authenticated, or every policy in the DB starts failing. Only revoke trigger bodies and internal helpers not referenced by any policy. Enumerate policy-referenced functions first (pg_policies definition scan) and keep them granted.
- Verification: after the migration, run the full web test suite against local Supabase AND exercise login→board→story edit→invite manually; a missed grant fails loudly (permission denied for function).
ACTIVITY_LOGS: make the activity trigger functions SECURITY DEFINER (they currently run as the invoking user, which is why a client INSERT policy exists at all), then DROP the client INSERT policy on activity_logs — triggers keep working, direct client inserts die, and the composite FK (story_id, project_id) → stories(id, project_id) closes the cross-project reference (needs the matching UNIQUE(id, project_id) on stories first; both in this migration). Backfill check: assert no existing rows violate the FK before adding it.
WEBHOOK_SECRET: move it out of integrations.config into a new column (or table) with NO select exposure: owner SELECT policy switches to a redacted view (or column-level: revoke select on the secret column from authenticated — column grants work for this). Settings UI shows 'set/rotate' only; the Edge Function reads it with the service key. One-time migration copies existing secrets over.
Run rls-security-reviewer; also re-check spec/mcp.md's RPC list against the final grant list (agent = authenticated role).
<!-- SECTION:NOTES:END -->
