---
id: TASK-242
title: >-
  CI: GitHub Actions publishes multi-arch image to ghcr (edge on main, latest +
  version on v* tags)
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-05 15:47'
updated_date: '2026-09-06 01:37'
labels: []
milestone: m-8
dependencies:
  - TASK-238
  - TASK-241
references:
  - docs/design/2026-09-05-self-host-rewrite-design.md
priority: medium
type: chore
ordinal: 700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design doc section 7. Replace the deleted deploy workflow with build-and-publish: on push to main build linux/amd64 + linux/arm64 with buildx and push ghcr.io/l4l4dev/storylane:edge; on v* tags push :latest and :<version>. Run bun test, web tests and lint before the build. Image labels carry the commit SHA and version for the settings page.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Workflow file exists, passes actionlint, and runs tests before building
- [ ] #2 main push publishes :edge for both architectures (verified by docker manifest inspect after the owner enables ghcr packages)
- [ ] #3 Tag push publishes :latest and :<version>
- [ ] #4 README shows the docker run one-liner using the ghcr image
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done on rewrite/self-hosted (2886199): .github/workflows/publish.yml (test job: core/server/web tests, lint, typecheck; image job on push: multi-arch to ghcr with edge/rewrite/semver/latest tags), Dockerfile GIT_SHA→STORYLANE_GIT_SHA, README image tags. Owner acceptance after first push: docker manifest inspect ghcr.io/l4l4dev/storylane:rewrite shows amd64+arm64, then set the ghcr package to public. Deferred: SHA-pin actions.
<!-- SECTION:NOTES:END -->
