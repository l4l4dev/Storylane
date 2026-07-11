---
id: TASK-53
title: >-
  Fix git-webhook error swallowing: transactional finish+assign RPC,
  failure-path tests
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 16:10'
updated_date: '2026-07-11 19:32'
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
- [ ] #1 Webhook never returns 200 unless finish AND iteration assignment both committed
- [ ] #2 Concurrent finalization cannot interleave between transition and assignment (single transaction/lock)
- [ ] #3 Failure-path tests cover iteration lookup and assignment errors
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Full Codex report: backlog doc-1 (.backlog/docs/reviews/) — read the matching finding before implementing.

DESIGN (Fable, 2026-07-12 — treat as the advisor-approved design):
New RPC finish_story_from_git(p_project_id, p_story_number int) returning jsonb events, SECURITY DEFINER. CRITICAL: it takes the SAME advisory lock as finalize_iteration ('iteration_finalize:'||project_id) so a webhook finish can never interleave with a rollover/manual finish — this is what makes 'assign to current iteration' safe. Inside one transaction: (1) verify projects.workflow_mode='tracker' (TASK-28 rule moves into the RPC, single enforcement point), return an 'ignored' event otherwise; (2) conditional transition to 'finished' only from the allowed states (keep the current webhook semantics; guard is a WHERE predicate so 0 rows = explicit 'not transitionable' event, never silent); (3) if iteration_id is null, assign the current iteration — under the shared lock the current iteration cannot finalize mid-flight; (4) any failure raises, nothing partial commits.
Edge Function becomes: one rpc() call; on error return 5xx so the git provider retries (today's 200-on-failure is the bug); type the injected client with a narrow interface (kills the bare 'any'). Failure-path tests: RPC error → 5xx; not-transitionable → 200 with ignored event; mode=free → 200 ignored.
GRANT: EXECUTE to service_role only (the webhook runs server-side), NOT to authenticated — verify which key the Edge Function client uses at implementation time and align. Sequencing with TASK-24 (Slack → DB webhook): do TASK-53 first (correctness), TASK-24 builds on the RPC's events afterwards.
<!-- SECTION:NOTES:END -->
