---
id: TASK-24
title: Move Slack notifications to DB webhook → Edge Function (pre-iOS prerequisite)
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-08 07:45'
updated_date: '2026-07-16 04:21'
labels:
  - db
  - ios
milestone: m-4
dependencies: []
priority: low
ordinal: 1600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per decision-1: Slack notifications currently fire only from Web server actions (after() + lib/integrations/slack.ts), so future iOS writes would silently skip them. Before the first iOS write path ships, relocate state-change / iteration start-done Slack notifications to a client-agnostic path: Database Webhook (or trigger + pg_net) on the relevant writes invoking an Edge Function that reads integrations config and posts to Slack. Web's server-action Slack calls are then removed. Not a Phase-1 Web task — schedule at iOS-phase start.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Slack notifications fire on state changes and iteration start/done regardless of which client performed the write (verified by direct DB write in a test)
- [ ] #2 Web server actions no longer call notifySlack; single notification per event (no double-fire during migration)
- [ ] #3 Edge Function reads integrations config server-side; secrets never reach clients; failures don't block the originating write
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @l4l4dev
created: 2026-07-08 12:39
---
Deferred to iOS phase start per advisor-assisted prioritization pass (2026-07-08) — see TASK-19..TASK-17 for the current Web-phase sequence.
---

created: 2026-07-09 05:10
---
Ordinal 16000 → 22000 (2026-07-09): with TASK-3 (deploy) moved to the tail of the Web phase, this task's documented decision 'schedule at iOS-phase start' means it belongs after TASK-3, not before it. Now ordered: all Web tasks → TASK-3 deploy → TASK-24 → iOS work.
---
<!-- COMMENTS:END -->
