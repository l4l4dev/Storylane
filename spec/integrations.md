← [SPEC.md](../SPEC.md)

## Integration Implementation Notes

### GitHub / Forgejo Webhooks
1. Include the story ID in the PR title or branch name (e.g. `[SL-123]` or `storylane/123`)
   - ID は `stories.number`（プロジェクト毎の連番、Task 12 で追加）を指す。UUID は使わない
2. Receive and parse the webhook in a Supabase Edge Function (`git-webhook`)
   - Webhook URL はプロジェクトをクエリで識別する: `/functions/v1/git-webhook?project=<project_id>`
   - 署名検証の secret は `integrations.config.webhook_secret`（プロジェクト設定で登録）
   - 署名検証・イベント種別判定・story 番号抽出まで済んだら、抽出した番号ごとに
     **`finish_story_from_git(project_id, number)` RPC を1回ずつ呼ぶ**（TASK-53,
     `20260715000003_finish_story_from_git.sql`）。state 更新と iteration アサインを
     このRPCが1トランザクションで行う（下記3）。
3. Finish + assign は単一のトランザクショナル RPC（`finish_story_from_git`）
   - **単一ワークフロー**（doc-8 §1 で free モード撤去）: モード判定は不要になった。
     全プロジェクトが対象。
   - **マージ先 state は設定可能**（doc-8 §2）: `integrations.config` の
     `merge_target_state_id` が指す `project_states` 行へ遷移する（classic テンプレの
     既定は Finished、未設定 = 連携無効で `ignored` を返す）。ガードは **前進のみ**で、
     `done` / `rejected` カテゴリには決して入れない。`set_story_state` の
     any→any を GitHub 連携でも濫用しないためのサーバ側制約。
   - すでにターゲット以降にある story は `not_transitionable` イベントを返し何もしない
     （0行更新を明示的に返すので、リトライしても冪等）。
   - このとき iteration 未所属（Backlog/Icebox）だった story は **current iteration にも
     アサインする** — board 上は `unstarted` カテゴリの state しかゾーンを跨げないため、
     ターゲット state のまま Backlog に取り残されると救出できない。
     マージ＝作業は今の iteration で行われた、とみなす。
   - **`finalize_iteration` と同じ advisory lock**（`iteration_finalize:<project_id>`）を取るので、
     state 遷移と iteration アサインの間に rollover / manual finish が割り込めない
     （Codex 指摘: 2段書き込みの interleave / 割り当て失敗で stranded）。
   - RPC は `SECURITY DEFINER`・**EXECUTE は service_role のみ**（`authenticated`/`anon` から
     revoke）。Edge Function は service role キーで呼ぶ。更新対象は引数の project と
     一致する story に限定される。
   - Edge Function は RPC が1件でもエラーを返したら **5xx を返す**（today's 200-on-failure が
     バグだった）。git provider が同じ delivery を再送し、冪等な RPC が安全に再処理する。

**Forgejo の差異**: ペイロード本体は GitHub 互換だが、ヘッダーと署名方式が異なる。
- イベント種別: `X-GitHub-Event` ではなく `X-Gitea-Event`
- 署名: `X-Hub-Signature-256`（HMAC-SHA256, `sha256=` プレフィックス）ではなく `X-Gitea-Signature`（HMAC-SHA256, プレフィックスなし）
- Edge Function は両ヘッダーを見て provider を判別し、署名検証を分岐する

### Slack Notifications
- Register an Incoming Webhook URL in project settings（`integrations.config.webhook_url`）
- **送信経路（TASK-24, 2026-07-21・decision-1 §3 に基づき 2026-07-07 の「server action から直接 POST」決定を差し戻し）**:
  DB トリガーが通知を発火する。story の状態遷移は `log_story_activity` が書く
  `activity_logs`（`action='story.state_changed'`）の AFTER INSERT トリガー、iteration の
  finalize/start は `iterations` テーブルへの AFTER UPDATE(state→done)/AFTER INSERT トリガーで
  拾い、いずれも `notify_slack_event`（SECURITY DEFINER）が `public.slack_notifications`
  アウトボックス行を記録しつつ pg_net で `slack-notify` Edge Function を非同期に呼ぶ。Edge
  Function は service role で対象行と `integrations` を読み、メッセージを組んで Slack へ POST する。
  - **なぜ差し戻したか**: 2026-07-07 の server-action 直 POST は Web のみを想定した経路で、
    iOS の直接書き込みはこの action を通らず通知が飛ばない。DB トリガー駆動なら
    どのクライアント（Web / iOS / Edge / MCP）の書き込みでも同じ経路で発火する。
  - 認証: `net.http_post` に JWT は乗らないので、Vault の共有シークレット
    （`slack_notify_secret`）を `x-slack-notify-secret` ヘッダで送り、Edge Function
    （`verify_jwt=false`）が突き合わせる。Edge Function の URL も Vault（`slack_notify_url`）。
  - gate: active な slack integration が無いプロジェクトはアウトボックス行も HTTP 呼び出しも
    作らない（トリガー内の事前チェック）。Edge Function は送信直前に `is_active` を再確認する。
- 通知タイミング: story の状態遷移（transition ボタン / ドラッグ / どのクライアントでも）、
  iteration の finalize・skip・start（lazy ロールオーバー / 手動 finish 時）。送信は
  fire-and-forget — pg_net が非同期に配送し、Slack 障害は元の書き込みをブロックしない。

### integrations.config の中身（provider 別）
| provider | config keys |
|---|---|
| `github` | `repo_url`, `webhook_secret`, `merge_target_state_id` (nullable — unset disables the merge transition) |
| `forgejo` | `repo_url`, `webhook_secret`, `merge_target_state_id` |
| `slack` | `webhook_url` |
