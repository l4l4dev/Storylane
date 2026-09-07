---
id: TASK-254
title: >-
  Phase-1 release: INSTALL/README updated for the setup flow, spec sweep
  (data-model prose), v0.1.0 tag, outside-person install test
status: To Do
assignee:
  - '@l4l4dev'
created_date: '2026-09-07 02:55'
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
