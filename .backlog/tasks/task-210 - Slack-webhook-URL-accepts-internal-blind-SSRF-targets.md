---
id: TASK-210
title: Slack webhook URL accepts internal/blind SSRF targets
status: To Do
assignee:
  - '@claude-opus-5'
created_date: '2026-07-27 06:08'
labels: []
milestone: m-2
dependencies: []
references:
  - supabase/functions/slack-notify/index.ts
  - 'apps/web/app/projects/[id]/settings/actions.ts'
priority: high
type: bug
ordinal: 1050
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
settings/actions.ts saveIntegration() stores any string as the Slack webhook_url with no validation beyond non-empty. supabase/functions/slack-notify/index.ts fetches that URL directly from the service-role Edge Function. A project owner can point it at an internal IP or a cloud metadata endpoint, and the Edge Function will fetch it with no host restriction — blind SSRF from a trusted service-role context. UI-only validation doesn't help since PostgREST accepts the raw upsert. Found via Codex external review, 2026-07-27.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 slack-notify rejects non-HTTPS webhook URLs
- [ ] #2 slack-notify rejects URLs containing userinfo (user:pass@host)
- [ ] #3 slack-notify rejects URLs resolving to private/link-local/loopback IP ranges and does not follow redirects into them
- [ ] #4 Existing valid hooks.slack.com webhook URLs continue to deliver notifications
<!-- AC:END -->
