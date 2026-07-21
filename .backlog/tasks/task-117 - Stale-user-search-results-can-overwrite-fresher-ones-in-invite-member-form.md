---
id: TASK-117
title: Stale user-search results can overwrite fresher ones in invite-member-form
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 11:00'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 11400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 finding #9. apps/web/components/features/projects/invite-member-form.tsx:33's debounced search effect calls setResults unconditionally on resolution with no request-id/abort guard — a slower earlier query can resolve after a faster later one and overwrite its results.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The debounced search guards against out-of-order responses (request-id or AbortController), so a stale slower response can never overwrite a fresher one
- [ ] #2 A test proves the race no longer reverts results to a stale query
- [ ] #3 pnpm test + lint green
<!-- AC:END -->
