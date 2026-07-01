← [SPEC.md](../SPEC.md)

## Integration Implementation Notes

### GitHub / Forgejo Webhooks
1. Include the story ID in the PR title or branch name (e.g. `[SL-123]` or `storylane/123`)
2. Receive and parse the webhook in a Supabase Edge Function
3. Update the matching story's state

### Slack Notifications
- Register an Incoming Webhook URL in project settings
- POST from Edge Functions on story state changes, comments, and iteration events
