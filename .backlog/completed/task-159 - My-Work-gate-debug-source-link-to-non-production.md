---
id: TASK-159
title: 'My Work: gate debug source link to non-production'
status: Done
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-22 13:40'
updated_date: '2026-07-23 01:18'
labels: []
milestone: m-5
dependencies: []
references:
  - >-
    .backlog/docs/reviews/doc-17 -
    17-—-UX-panel-review-2026-07-22-—-My-Work-screen-10-expert-ux-review.md
priority: low
type: chore
ordinal: 840
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From doc-17 Medium finding #15. A debug link sits in the primary title row beside the <h1>. Owner decision 2026-07-22: it's fine as-is as long as it does not render in production -- gate it behind a non-production check rather than redesigning its placement or wording.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The debug link does not render when the app is running in production
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Already satisfied -- no code change needed. Verified apps/web/app/my-work/page.tsx:221 already gates the debug link behind process.env.NODE_ENV !== "production" (implemented in TASK-147 AC#6, prior to this doc-17 finding being filed). This doc-17 Medium #15 finding was written before TASK-147 landed the gate; by the time this task was picked up, the requirement was already met. No further work required.
<!-- SECTION:FINAL_SUMMARY:END -->
