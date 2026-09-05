---
id: TASK-242
title: >-
  CI: GitHub Actions publishes multi-arch image to ghcr (edge on main, latest +
  version on v* tags)
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-05 15:47'
updated_date: '2026-09-05 15:48'
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
