---
id: TASK-24
title: Move Slack notifications to DB webhook → Edge Function (pre-iOS prerequisite)
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-08 07:45'
updated_date: '2026-07-21 05:06'
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
Advisor-reviewed 2026-07-21 (fable-advisor, Opus fallback): 修正付き承認。骨格(trigger + pg_net -> Edge Function、メッセージ整形は Edge Function 内複製)は妥当。以下の修正込みで実装:

1. iteration finalized/started/skipped は activity_logs に載せない(spec/screens.md 22行の feed 定義「story/comment changes」と衝突・無断拡張になる)。iterations テーブルへの直接トリガー: AFTER UPDATE OF state WHEN (NEW.state='done' AND OLD.state IS DISTINCT FROM NEW.state) と AFTER INSERT。NEW.number/velocity/capacity/skipped/start_date/end_date を読む(finalize_iteration の jsonb 再パース不要)。
2. story 側は既存 log_story_activity が作る activity_logs 行に AFTER INSERT WHEN (NEW.action='story.state_changed') の通知トリガーを足す(story.state_changed は元々 feed に出る action なので矛盾なし)。
3. メッセージ整形は Edge Function 内に複製(packages/core 移動は却下 — Deno workspace import の前例ゼロ)。複製対象: apps/web/lib/utils/slack.ts の4関数 + iterationLabel(iterations.ts) + stateName ヘルパー(null->"Icebox", 不明id->"Unknown")。slack.ts の既存テストと同じ入出力ペア数件を Deno test 側にも置いて両方 assert(golden の軽量版)。
4. pg_net 新規インフラ: create extension pg_net。認証は Vault(vault.decrypted_secrets)に共有シークレット、trigger 関数が読み出して Authorization/カスタムヘッダに載せ、Edge Function(verify_jwt=false)が git-webhook 流で自前検証。migration にシークレット直書き禁止(CLAUDE.md Do Not + public repo)。
5. slack-notify Edge Function 新規(config.toml に verify_jwt=false 追加)。integrations 行(config.webhook_url, is_active)を service_role で読む。失敗は握りつぶし(pg_net 非同期なので元 write に影響なし)。
6. AC#1 テスト: 直接 DB 書き込み -> net.http_request_queue に正しい url/body で1行 enqueue を assert(既存 *.integration.test.ts の RUN フラグ方式)。実配送は host.docker.internal 制約 + 非同期のため自動スイートに含めない(手動/ローカル1回のみ)。
7. AC#2 二重発火: board/actions.ts の5箇所 notifySlack 削除 + lib/integrations/slack.ts 削除を、上記 trigger migration と同一デプロイでまとめる。デプロイ順序(migration -> app)を手順化。
8. spec/integrations.md 43-48行を decision-1 §3(iOS 直書きが server action を経由しない)根拠明記で書き換え。
9. migration 一式は rls-security-reviewer 追加パス必須。
10. 着手は TASK-87 コミット後 -> 既に完了済み(今セッション 9cabf9b/fc55266)。
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
