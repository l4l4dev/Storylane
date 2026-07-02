← [SPEC.md](../SPEC.md)

## Integration Implementation Notes

### GitHub / Forgejo Webhooks
1. Include the story ID in the PR title or branch name (e.g. `[SL-123]` or `storylane/123`)
   - ID は `stories.number`（プロジェクト毎の連番、Task 12 で追加）を指す。UUID は使わない
2. Receive and parse the webhook in a Supabase Edge Function
3. Update the matching story's state

**Forgejo の差異**: ペイロード本体は GitHub 互換だが、ヘッダーと署名方式が異なる。
- イベント種別: `X-GitHub-Event` ではなく `X-Gitea-Event`
- 署名: `X-Hub-Signature-256`（HMAC-SHA256, `sha256=` プレフィックス）ではなく `X-Gitea-Signature`（HMAC-SHA256, プレフィックスなし）
- Edge Function は両ヘッダーを見て provider を判別し、署名検証を分岐する

### Slack Notifications
- Register an Incoming Webhook URL in project settings
- POST from Edge Functions on story state changes, comments, and iteration events
