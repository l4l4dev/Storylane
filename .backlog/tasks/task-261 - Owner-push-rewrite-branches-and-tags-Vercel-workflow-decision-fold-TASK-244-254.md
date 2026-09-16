---
id: TASK-261
title: >-
  Owner: push rewrite branches and tags, Vercel workflow decision, fold
  TASK-244/254
status: To Do
assignee:
  - '@l4l4dev'
created_date: '2026-09-16 11:56'
labels: []
milestone: m-10
dependencies: []
references:
  - .backlog/docs
documentation:
  - doc-28
priority: high
type: task
ordinal: 50
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner-only steps from Backlog doc-28. The 91 rewrite commits and the tags exist only on the owner's machine; design §4 forbids commits on main until rewrite/tracker merges, so the Vercel deploy workflow on main must be confirmed dormant or gated; TASK-244/254 (phase 0/1 release) are proposed to fold into one "Tracker first release" task so m-8/m-9 can close.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 git push origin rewrite/tracker rewrite/self-hosted rewrite/phase-1 and git push origin rewrite-phase-0 rewrite-phase-1 done
- [ ] #2 Decision recorded in this task: Vercel deploy on main is dormant / gated / removed
- [ ] #3 Decision recorded in this task: TASK-244 and TASK-254 folded into one release task or kept
<!-- AC:END -->
