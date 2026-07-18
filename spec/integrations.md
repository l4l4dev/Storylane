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
- **送信経路（2026-07-07 オーナー決定・旧「Edge Function から POST」を置き換え）**:
  Next.js の server action から共有ヘルパー（`apps/web/lib/integrations/slack.ts`）経由で
  Slack Incoming Webhook に直接 POST する。Edge Function は使わない
  （Webhook 受信と違い公開エンドポイントが不要なため）。
- 通知タイミング: story の状態遷移（transition ボタン / ドラッグ）、iteration の完了
  （lazy ロールオーバー時）。送信は fire-and-forget — Slack 障害で操作を失敗させない。

### integrations.config の中身（provider 別）
| provider | config keys |
|---|---|
| `github` | `repo_url`, `webhook_secret`, `merge_target_state_id` (nullable — unset disables the merge transition) |
| `forgejo` | `repo_url`, `webhook_secret`, `merge_target_state_id` |
| `slack` | `webhook_url` |
