---
id: TASK-107
title: Shared toast + Project Settings save feedback
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 06:00'
labels:
  - web
dependencies: []
priority: medium
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-11 D5. Add a lightweight shared toast (Radix Toast; radix-ui is already a dep, no new dependency) mounted once in the app shell, so user actions get visible confirmation. First consumer: Project Settings save ('Project updated'). Shaped so other forms can adopt it. See .backlog/docs/doc-11.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A <Toaster> is mounted once in the app shell and a small toast() helper exists, built on Radix Toast (no new dependency)
- [ ] #2 Saving Project Settings shows a success toast; the success signal reuses the existing invite_failed query-param + client-read pattern (redirect with a success param a client component reads) rather than new plumbing
- [ ] #3 The toast helper is reusable by other forms (labels/working-days/states/invites) without per-form bespoke wiring
- [ ] #4 UI passes fable-advisor design review; pnpm test + lint green
<!-- AC:END -->
