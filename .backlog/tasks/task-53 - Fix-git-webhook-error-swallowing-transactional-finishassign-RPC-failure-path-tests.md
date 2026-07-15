---
id: TASK-53
title: >-
  Fix git-webhook error swallowing: transactional finish+assign RPC,
  failure-path tests
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 16:10'
updated_date: '2026-07-15 00:48'
labels:
  - bug
  - webhook
  - db
milestone: m-1
dependencies: []
priority: high
ordinal: 14200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex full-codebase review (2026-07-12), High: supabase/functions/git-webhook/index.ts:163-203 ignores the current-iteration read error and the iteration_id update error, returning 200 while the story may be finished but stranded outside an iteration; the git provider never retries. Also covers two related findings: state transition + iteration assignment run as separate requests (a finalization can land between them), and the test suite has no failure-path coverage for the second write.

Fix: move 'conditional finish + active-iteration lock + assignment' into ONE transactional RPC (aligns with the finalize_iteration advisory-lock pattern); handler returns a retryable failure unless the whole operation succeeds; add failure-path tests (iteration lookup error, assignment error). Optionally type the injected client (drop the bare any) while in the file. Coordinate with TASK-24 (Slack → DB webhook/Edge Function) — same file, decide sequencing when picked up.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Webhook never returns 200 unless finish AND iteration assignment both committed
- [x] #2 Concurrent finalization cannot interleave between transition and assignment (single transaction/lock)
- [x] #3 Failure-path tests cover iteration lookup and assignment errors
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Migration 20260715000003_finish_story_from_git.sql: SECURITY DEFINER finish_story_from_git(p_project_id uuid, p_story_number int) returns jsonb. (a) read workflow_mode; non-tracker/not-found -> [{kind:ignored,reason}]. (b) pg_advisory_xact_lock('iteration_finalize:'||project) — same key as finalize_iteration. (c) conditional UPDATE state='finished' WHERE state in (unscheduled,unstarted,started) RETURNING id, iteration_id; 0 rows -> [{kind:not_transitionable}]. (d) if iteration_id null, find latest non-done iteration, assign; return [{kind:finished, iteration_number?}]. revoke execute from public,authenticated (service_role keeps it).
2. Edge Function index.ts: replace table finish+assign block with per-number supabase.rpc('finish_story_from_git'); any rpc error -> 5xx (retryable); drop the projects mode pre-check (RPC is single enforcement point); narrow-type the injected client (kill bare any). Return 200 {matched, events}.
3. Tests index.test.ts: add rpc() to fake; happy path (finished event), rpc error -> 5xx, not-transitionable -> 200 ignored, free mode -> 200 ignored via RPC. Apply migration locally, regen types, deno test + vitest.
4. rls-security-reviewer on migration (grant lockdown / SECURITY DEFINER / lock), address, verification steps, commit.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Full Codex report: backlog doc-1 (.backlog/docs/reviews/) — read the matching finding before implementing.

DESIGN (Fable, 2026-07-12 — treat as the advisor-approved design):
New RPC finish_story_from_git(p_project_id, p_story_number int) returning jsonb events, SECURITY DEFINER. CRITICAL: it takes the SAME advisory lock as finalize_iteration ('iteration_finalize:'||project_id) so a webhook finish can never interleave with a rollover/manual finish — this is what makes 'assign to current iteration' safe. Inside one transaction: (1) verify projects.workflow_mode='tracker' (TASK-28 rule moves into the RPC, single enforcement point), return an 'ignored' event otherwise; (2) conditional transition to 'finished' only from the allowed states (keep the current webhook semantics; guard is a WHERE predicate so 0 rows = explicit 'not transitionable' event, never silent); (3) if iteration_id is null, assign the current iteration — under the shared lock the current iteration cannot finalize mid-flight; (4) any failure raises, nothing partial commits.
Edge Function becomes: one rpc() call; on error return 5xx so the git provider retries (today's 200-on-failure is the bug); type the injected client with a narrow interface (kills the bare 'any'). Failure-path tests: RPC error → 5xx; not-transitionable → 200 with ignored event; mode=free → 200 ignored.
GRANT: EXECUTE to service_role only (the webhook runs server-side), NOT to authenticated — verify which key the Edge Function client uses at implementation time and align. Sequencing with TASK-24 (Slack → DB webhook): do TASK-53 first (correctness), TASK-24 builds on the RPC's events afterwards.

IMPLEMENTED (2026-07-15, Opus 4.8):
- Migration 20260715000003_finish_story_from_git.sql: SECURITY DEFINER finish_story_from_git(p_project_id uuid, p_story_number int) returns jsonb. Reads workflow_mode (non-tracker/not-found -> ignored event); takes the SAME advisory lock as finalize_iteration; conditional UPDATE state='finished' WHERE state in (unscheduled,unstarted,started) RETURNING id, iteration_id (0 rows -> not_transitionable event); if iteration_id null, assigns latest non-done iteration; returns finished event (with iteration_number when assigned). GRANT locked down: revoke execute from public, authenticated -> service_role only (verified has_function_privilege: auth=false, anon=false, svc=true). Applied locally, types regenerated.
- Edge Function git-webhook/index.ts: replaced the two-write finish+assign block (which swallowed the iteration read + assignment errors and returned 200) with a per-number rpc('finish_story_from_git') loop; any rpc error -> 5xx retryable; removed the redundant projects mode pre-check (RPC is the single enforcement point); narrow-typed the injected client (WebhookClient interface) killing the bare any; wrapped Deno.serve to keep the client param defaulted.
- spec/integrations.md: updated the webhook section to the RPC architecture (single enforcement point, advisory lock, 5xx-on-failure, service_role-only grant).
- Tests: index.test.ts rewritten with rpc fake — happy path, free-mode ignored, not_transitionable, rpc-error 5xx, multi-story stops at first error, no-match. 6 deno tests pass. finish-story-from-git.integration.test.ts (SUPABASE_INTEGRATION) verifies finish+assign, already-assigned untouched, not_transitionable (accepted + nonexistent) against real DB — 4 pass. Full web suite 425 pass, tsc/eslint clean, deno check clean.
Reviews: rls-security-reviewer in progress.

REVIEW DONE (rls-security-reviewer, 2026-07-15): no issues, no fixes required. All 6 points verified against the live local DB: search_path pinned; grant lockdown airtight (has_function_privilege anon=false/auth=false/service_role=true) and is the sole boundary (Edge Function HMAC-verifies per-project secret before calling); UPDATE + iteration lookup correctly scoped to p_project_id (tested with two projects sharing story number 1 — no cross-project effect); reject_done_iteration trigger no gap under the shared advisory lock; SECURITY DEFINER writes are the intended service-role path (stories RLS still enabled); grant lockdown is a net improvement over the codebase's PUBLIC-EXECUTE RPCs. Optional follow-up (non-blocking): documented the service-role-only revoke pattern in .claude/commands/db-migrate.md so future RPCs of this shape don't get left PUBLIC-executable (relates to TASK-55 grant lockdown).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Moved the git-webhook's finish + current-iteration assignment into one SECURITY DEFINER RPC (finish_story_from_git, migration 20260715000003) under the same advisory lock as finalize_iteration, so a rollover can't interleave and a failed assignment can't leave a finished story stranded. The Edge Function now calls the RPC once per matched story number and returns a retryable 5xx on any failure (was 200-on-failure); tracker-mode enforcement moved into the RPC (single point); injected client narrow-typed (no bare any); EXECUTE revoked from public/authenticated (service_role-only, the sole auth boundary). Verified: 6 deno unit tests (incl. 5xx path), 4 service-role integration tests against the real RPC, 425 web tests, tsc/eslint/deno check clean, rls-security-reviewer no issues. Committed as aeedc1b.
<!-- SECTION:FINAL_SUMMARY:END -->
