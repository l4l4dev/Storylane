---
id: TASK-23
title: 'Fix: @mention regex has no left boundary; Slack text is not escaped'
status: To Do
assignee: []
created_date: '2026-07-08 05:31'
labels:
  - web
  - bug
dependencies: []
priority: medium
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Code review 2026-07-08 (apps/web/lib/utils/comments.ts, slack.ts). Two small correctness bugs in text handling:

1. MENTION_PATTERN = /@([a-z0-9_]{3,30})/gi (comments.ts:4) matches anywhere, including inside emails/words. A comment 'reach me at mary@storylane.dev' makes extractMentions return ['storylane']; a member named storylane gets a false 'you were mentioned' notification (notifications.ts:47) and parseCommentBody renders the middle of the email as a mention chip. Fix: require start-of-string or a non-word char before @ (e.g. /(?<![\w@])@([a-z0-9_]{3,30})/gi).

2. storyStateChangeMessage (slack.ts:9) interpolates story title/status into Slack text without escaping Slack's control chars &, <, >. notifySlack (lib/integrations/slack.ts:36) posts it raw as { text }. A story titled 'Render <UserList> & fix' renders mangled in Slack (< > is link/mention syntax). Same for custom status names in dropStoryFree. Fix: escape &->&amp; <->&lt; >->&gt; before building the message.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 extractMentions/parseCommentBody do not treat @handle inside an email or word as a mention; existing mention cases still work
- [ ] #2 Slack message text escapes &, <, > for story titles and custom status names
- [ ] #3 Tests cover email-in-comment (no false mention) and a title containing & < >
<!-- AC:END -->
