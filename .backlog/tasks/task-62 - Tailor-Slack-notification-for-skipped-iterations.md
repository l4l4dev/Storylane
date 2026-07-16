---
id: TASK-62
title: Tailor Slack notification for skipped iterations
status: To Do
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-14 16:06'
updated_date: '2026-07-15 23:54'
labels:
  - web
  - slack
  - copy
milestone: m-0
dependencies: []
priority: low
ordinal: 46000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
fable-advisor follow-up from TASK-38: notifyFinalizeEvents (apps/web/app/projects/[id]/board/actions.ts) sends the normal iterationDoneMessage ('iteration #N done, velocity 0') even when an iteration was skipped. On Slack a skip reads as a completed-with-zero iteration. Use the 'skipped' flag now carried on the 'finalized' finalize event to send a skip-specific message (e.g. 'Iteration #N skipped') instead. Small copy/logic tweak, no schema change — the skipped flag already exists on the event (see FinalizeIterationEvent) and on iterations.skipped.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A finalized event with skipped=true produces a skip-specific Slack message, not the velocity-0 done message
- [ ] #2 Non-skipped finalize still sends the existing done message
<!-- AC:END -->
