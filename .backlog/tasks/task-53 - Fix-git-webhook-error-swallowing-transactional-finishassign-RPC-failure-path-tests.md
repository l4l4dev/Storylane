---
id: TASK-53
title: >-
  Fix git-webhook error swallowing: transactional finish+assign RPC,
  failure-path tests
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 16:10'
labels:
  - bug
  - webhook
  - db
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
