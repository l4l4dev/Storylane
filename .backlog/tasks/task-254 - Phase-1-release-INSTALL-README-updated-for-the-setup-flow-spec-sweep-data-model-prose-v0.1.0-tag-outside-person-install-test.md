---
id: TASK-254
title: >-
  Phase-1 release: INSTALL/README updated for the setup flow, spec sweep
  (data-model prose), v0.1.0 tag, outside-person install test
status: To Do
assignee:
  - '@l4l4dev'
created_date: '2026-09-07 02:55'
updated_date: '2026-09-08 05:17'
labels: []
milestone: m-9
dependencies:
  - TASK-253
references:
  - docs/design/2026-09-05-self-host-rewrite-design.md
priority: medium
type: task
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Exit of phase 1 (design §9): a stranger can docker run and use a board. Update INSTALL.md §1 (setup token from docker logs, setup page), README 'try in 60 seconds', spec/data-model.md Supabase-era prose sweep (deferred from TASK-237), cut v0.1.0 (bump apps/server/package.json version, tag, push → :latest published), then have at least one outside person install it and record their friction as new tasks before phase 2 starts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 INSTALL.md §1 walks through the setup token and setup page accurately
- [ ] #2 v0.1.0 published; docker run ghcr.io/l4l4dev/storylane (latest) works on a clean machine
- [ ] #3 Outside install performed; friction captured as Backlog tasks
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Phase-1 implementation closed 2026-09-08 on rewrite/phase-1 (3f5177c..ab33252, 52 commits). Final whole-branch review (Opus): 1 Critical (Bun.serve idleTimeout 10 s default killed SSE streams before the 20 s heartbeat) + 6 Important, all fixed in 9211472..ab33252; report at .superpowers/sdd/2026-09-07-self-host-phase-1/final-review/REPORT.md (git-ignored; read before deleting the workspace). Owner steps before this task: apply .superpowers/.../final-review/ENV-EXAMPLE-OWNER-DIFF.md to .env.example (STORYLANE_BIND, STORYLANE_IMAGE_TAG=edge until v0.1.0); run /code-review high on rewrite/phase-1; open PR rewrite/phase-1 → main (after TASK-244 merges phase 0); remove the owner's personal name from .backlog/completed/task-91 line 186 (pre-existing public-repo violation, introduced in c3fa30f). Design §4 now records session 30 d/14 d and login limits 20/IP, 5/email per 15 min. Follow-up candidates (need approval to create): stale story.stateId during the optimistic window; SSE re-auth + last-owner guard with member routes; CSP; packages/core typecheck; graceful shutdown; PR image build in CI; STORYLANE_GIT_SHA consumer; wall-clock idleTimeout regression test; advisor 'later' UX items.

2026-09-08 controller docker check found the image build broken (web stage lacked packages/core after the board's @storylane/core import); fixed in 7fd4f44 together with a build-only image-check job on pull requests. Image verified locally: builds, boots, /healthz 200, setup_required gate, setup token in logs, 81 MB. Branch HEAD for review: 7fd4f44.

Continuation 2026-09-08 (owner: 続けられるものは続けて): spec sweep done in 17944bc + 0c685bb (Supabase/RLS/Edge Function/OAuth prose → server/withProject/SSE/worker wording; spec/mcp.md and spec/integrations.md carry a stack note instead of a rewrite). Open spec decisions for the owner: scheduled iteration-rollover mechanism (spec/velocity.md Rollover), MCP tool shape over PAT + JSON API, integrations route/worker layout, users/profiles merge in spec/data-model.md. Also fixed without new tasks: optimistic-window stateId (e1f6ca9), graceful shutdown (a9c3267), STORYLANE_GIT_SHA logged at boot (fb5278a), packages/core typecheck gate in CI (bcbcaec), awaited session refresh after invite/reset (093fab5), test-results ignored (50b4e63). Branch HEAD for review: 093fab5; server 525 / web 64 / core 85 tests, all lint/typecheck/build green. Acceptance #1 (INSTALL §1 setup flow) is satisfied by the text; owner verifies on the real image.
<!-- SECTION:NOTES:END -->
