---
id: TASK-244
title: >-
  Phase 0 acceptance: /code-review high, push rewrite/self-hosted, make ghcr
  package public, merge PR to main
status: To Do
assignee:
  - '@l4l4dev'
created_date: '2026-09-07 02:54'
labels: []
milestone: m-8
dependencies: []
references:
  - docs/design/2026-09-05-self-host-rewrite-design.md
priority: high
type: task
ordinal: 900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner-only steps that close phase 0 (design doc §9). Apply the two-line .env.example change handed over in chat (agents are denied **/.env.*), run /code-review high on rewrite/self-hosted, fix findings, push the branch, wait for the publish workflow, set the ghcr package 'storylane' to public, verify the multi-arch manifest, open the PR to main (Codex review runs on open), merge.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 .env.example committed with STORYLANE_IMAGE_TAG=edge and STORYLANE_BIND documented
- [ ] #2 /code-review high findings resolved or explicitly deferred with a note
- [ ] #3 docker manifest inspect ghcr.io/l4l4dev/storylane:rewrite lists linux/amd64 and linux/arm64; package visibility is public
- [ ] #4 PR rewrite/self-hosted → main merged; .superpowers/sdd/2026-09-06-self-host-phase-0/ deleted afterwards
<!-- AC:END -->
