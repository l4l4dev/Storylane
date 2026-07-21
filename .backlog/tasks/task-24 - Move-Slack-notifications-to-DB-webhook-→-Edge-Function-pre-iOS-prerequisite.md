---
id: TASK-24
title: Move Slack notifications to DB webhook → Edge Function (pre-iOS prerequisite)
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-08 07:45'
updated_date: '2026-07-21 05:08'
labels:
  - db
  - ios
milestone: m-4
dependencies: []
priority: low
ordinal: 15000
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Advisor-reviewed 2026-07-21 (fable-advisor, Opus fallback), then re-reviewed for the outbox addition. As-built:

1. Story state changes ride the activity_logs row log_story_activity already writes: an AFTER INSERT trigger on activity_logs WHEN (action='story.state_changed'). Iteration finalize/start are NOT put in activity_logs (spec/screens.md defines that feed as story/comment changes only) — they ride triggers on the iterations table: AFTER UPDATE OF state WHEN (new.state='done' AND old.state IS DISTINCT FROM new.state) and AFTER INSERT.
2. All three triggers call trg_slack_notify(tg_argv), which perform-calls notify_slack_event(type, project_id, ref_id) (SECURITY DEFINER, owned by postgres).
3. Outbox: notify_slack_event, gated on an active slack integration, records a public.slack_notifications row (id, project_id, event_type, ref_id, created_at) and fires an async net.http_post (pg_net) to the slack-notify Edge Function. The outbox exists because pg_net's queue drains in ~1-2s and PostgREST doesn't expose the net schema, so the queue can't be asserted from the integration harness (and adding a raw pg dep was rejected) — the durable public row is what makes AC#1 testable race-free. RLS: owner-only SELECT; no INSERT/UPDATE/DELETE policies (deny-by-absence, same as activity_logs), so only the SECURITY DEFINER trigger and service_role write.
4. Message formatting is duplicated into the Edge Function (Deno cannot import the web workspace — no import map precedent): slack.ts's four functions + iterationLabel + a null->"Icebox" resolve. The vitest and Deno tests assert the same input/output pairs to catch drift.
5. slack-notify Edge Function (config.toml verify_jwt=false): reads the referenced row + integrations (config.webhook_url, is_active) with the service role, re-checks is_active at send time, posts to Slack, and always 200s on Slack-side failure (fire-and-forget; pg_net is async so the originating write is untouched).
6. Auth for the pg_net call: a shared secret in the x-slack-notify-secret header, compared timing-safe against SLACK_NOTIFY_SECRET in the Edge Function. The Edge URL + secret live in Vault (slack_notify_url / slack_notify_secret), never in source; local dev seeds them in seed.sql. A DB with no secrets records the outbox row and skips the POST (no error).
7. AC#1 test: a DIRECT table write (service role, no web action) produces a slack_notifications row — proving the client-agnostic path. Also covers the no-integration gate and post-deactivation stop. Real pg_net delivery is not in the automated suite (host.docker.internal + async); it's a one-off manual/local check.
8. AC#2 (no double-fire): the Web notifySlack calls (board/actions.ts x5 + notifyFinalizeEvents) and lib/integrations/slack.ts / lib/utils/slack.ts / the now-unused admin client are removed in the SAME change as the trigger migration. Production must apply the migration and the app deploy together.
9. spec/integrations.md rewritten (decision-1 §3: iOS direct writes don't run the server action) and an ARCHITECTURE.md relation row added. Migration passed rls-security-reviewer.
10. Prerequisite TASK-87 already committed this session (9cabf9b/fc55266).
<!-- SECTION:PLAN:END -->

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

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Moved Slack notifications off the Web server action onto a DB trigger -> pg_net -> slack-notify Edge Function, with a public.slack_notifications outbox for durability + testability. Story state changes ride activity_logs (story.state_changed); iteration finalize/start ride iterations table triggers (not activity_logs, per spec feed definition). Auth: Vault shared secret header, Edge re-checks is_active at send time. Removed all Web notifySlack calls + lib/integrations/slack.ts + lib/utils/slack.ts + now-unused admin client (AC#2 no double-fire). Verified: fable-advisor (design + outbox re-review), rls-security-reviewer (clean vs local reset), 12 Deno tests (message-format drift-guard + handler), 4 outbox integration tests (direct-DB-write -> outbox row proves AC#1 client-agnostic; gate; deactivation), full web suite + tsc(web+mcp) + lint green. Deploy note: apply the migration and the app (notifySlack removal) in the same deploy to avoid a double-fire window; set the two Vault secrets (slack_notify_url, slack_notify_secret) + the slack-notify function's SLACK_NOTIFY_SECRET env in production.
<!-- SECTION:FINAL_SUMMARY:END -->
