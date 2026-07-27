---
id: doc-22
title: 22 — Deferred iOS port scope
type: specification
created_date: '2026-07-27 06:17'
updated_date: '2026-07-27 06:18'
---
# Deferred iOS port scope

## Sequencing decision (2026-07-01)

Implement all Web tasks before starting iOS. Web implementation can still change the specification, so stabilizing Web first minimizes rework in the iOS port. For the completed Web implementation history of Tasks 1–15, see **doc-4** (`backlog doc view doc-4 --plain`).

## Deferred scope

- Task 6: `IterationsView` (list / current iteration details / goal display and editing)
- Task 7: `EpicsView` (progress display) / label picker for story editing
- Task 9: comment list and input in `StoryDetailView` / Activity log screen
- Task 10: APNs push notifications — **on hold (none for now)**. Start after Apple Developer Program enrollment ($99/year). Until then, notifications are Web browser notifications only.
- Task 12.5: new lifecycle (including `unscheduled`) / automatic rollover support / Icebox display / state-transition buttons on cards / task (checklist) UI
- Task 13: error and empty states / loading / accessibility (VoiceOver and Dynamic Type) / performance
- Task 14 / Task 15 / requirements revised on 2026-07-07: confirm the iOS scope after the Web implementation is finalized.
