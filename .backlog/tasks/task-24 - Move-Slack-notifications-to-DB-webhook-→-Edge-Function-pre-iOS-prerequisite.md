---
id: TASK-24
title: Move Slack notifications to DB webhook → Edge Function (pre-iOS prerequisite)
status: To Do
assignee: []
created_date: '2026-07-08 07:45'
labels:
  - db
  - ios
dependencies: []
priority: low
ordinal: 28000
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
