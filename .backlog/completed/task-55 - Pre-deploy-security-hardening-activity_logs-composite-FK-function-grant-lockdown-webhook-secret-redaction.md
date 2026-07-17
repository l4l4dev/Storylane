---
id: TASK-55
title: >-
  Pre-deploy security hardening: function grant lockdown + activity_logs
  composite FK
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 16:11'
updated_date: '2026-07-15 05:39'
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
- [x] #1 Cross-project story references in activity_logs are impossible (composite FK) and direct client INSERT is denied
- [x] #2 Only intended RPC entry points are executable by authenticated; new functions are private by default
- [ ] #3 webhook_secret is never returned to any client query after creation
- [x] #4 rls-security-reviewer passes; existing web flows and finalize_iteration/invite_member RPCs still work under the new grants
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

SCOPE SPLIT (2026-07-15, owner decision): sub-area 3 (webhook_secret redaction, AC #3) carved out to TASK-63 — it needs schema+data migration+Edge Function+settings action+set/rotate UI, distinct from the two DB-hardening pieces here. This task now covers grant lockdown + activity_logs integrity (AC #1, #2, #4).

IMPLEMENTED:
- Migration 20260715000005_function_grant_lockdown.sql: revoke execute on all public functions from public+authenticated + revoke the default-privilege grant (the real hole was PUBLIC EXECUTE, not just the authenticated grant — has_function_privilege stayed true until PUBLIC was revoked). Re-grant EXECUTE to authenticated only for the 12 web .rpc() entry points + 3 policy-referenced helpers (project_role/is_project_member/shares_project_with, all on {authenticated} policies so anon needs none). Verified: authenticated has exactly those 15, triggers/internal + finish_story_from_git are false, anon false, service_role unchanged. New functions private-by-default.
- Migration 20260715000006_activity_logs_integrity.sql: stories UNIQUE(id, project_id); backfill guard; composite FK activity_logs(story_id, project_id)->stories(id, project_id) ON DELETE NO ACTION (existing single-col story_id SET NULL FK fires first on story delete, nulls story_id so the composite row isn't checked — verified empirically: story delete succeeds, log survives; cross-project insert rejected). promote_story_to_epic converted to SECURITY DEFINER (owner gate + project-scoped writes unchanged, same shape as move/copy) so its bespoke activity insert no longer needs the client policy; DROP the 'members can write activity' INSERT policy (all writers are SECURITY DEFINER now; web only ever SELECTs activity_logs).
- Verified: all 10 integration test files (58 tests) pass under the new grants — proves triggers still fire, promote/move/copy still insert activity, every RPC works. Full web suite 425 pass, tsc clean. Updated new-project-invite-search test: anon now gets 'permission denied for function' (grant-level) before the internal 'not signed in' guard — defense in depth.
Reviews: rls-security-reviewer pending on both migrations.

REVIEW DONE (rls-security-reviewer, 2026-07-15): both migrations verified live (db reset + psql + real GoTrue/PostgREST calls). 1 HIGH + minor findings, all addressed.

HIGH (addressed): the migration comment claimed 'new functions become private-by-default' — FALSE. Reviewer proved (4 ways) that 'alter default privileges ... revoke execute from public' does NOT suppress Postgres's built-in PUBLIC EXECUTE on CREATE once a pg_default_acl row exists, so a future migration's new function ships authenticated-callable unless it revokes explicitly. Fixes: (a) corrected the migration comment to state the real guarantee; (b) added a service_role-only _grant_audit() catalog function + grant-lockdown.integration.test.ts backstop that fails if any public function outside the 15-entry allowlist is authenticated/anon-executable (3 tests pass); (c) updated db-migrate.md item 5 to require explicit grant management for EVERY new function (helpers/triggers revoke from public+authenticated), not just service-role RPCs.

Migration 1 verified: policy-referenced set complete (only project_role/is_project_member/shares_project_with, all {authenticated} policies); triggers still fire with EXECUTE revoked (empirically: story insert assigns number + logs activity); signup works (handle_new_user->generate_username runs as owner under DEFINER); service_role retains all; finish_story_from_git stays service-role-only.
Migration 2 verified: composite FK blocks cross-project refs; story delete + log survival is NOT order-fragile (single-col SET NULL is AFTER-ROW, composite NO ACTION is AFTER-STATEMENT — SET NULL structurally first); project-delete cascade safe; direct client INSERT denied (403 RLS); promote as SECURITY DEFINER safe (owner gate before writes, all project-scoped, auth.uid()=caller).

Minor (addressed): promote DOWN placeholder clarified; spec/rls.md + spec/data-model.md updated with the activity_logs FK + insert-lockdown + function-grant notes.
Post-fix: 61 integration tests + 425 web tests pass, tsc/eslint clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Function EXECUTE grant lockdown (revoke PUBLIC/authenticated blanket grant; re-grant only the 12 web RPC entry points + 3 policy-referenced helpers; _grant_audit + grant-lockdown integration test as the backstop since the schema is not private-by-default) and activity_logs cross-project integrity (stories UNIQUE(id,project_id) + composite FK; promote_story_to_epic -> SECURITY DEFINER; drop the client INSERT policy). Migrations 20260715000005/6. Sub-area 3 (webhook_secret) split to TASK-63. Verified: 61 integration tests (incl. new grant-lockdown backstop) + 425 web tests, tsc/eslint clean, rls-security-reviewer (HIGH private-by-default claim corrected + backstopped). Committed as ceaffd2.
<!-- SECTION:FINAL_SUMMARY:END -->
