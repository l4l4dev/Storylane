---
id: TASK-23
title: 'Fix: @mention regex has no left boundary; Slack text is not escaped'
status: Done
assignee: []
created_date: '2026-07-08 05:31'
updated_date: '2026-07-09 04:43'
labels:
  - web
  - bug
dependencies: []
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Code review 2026-07-08 (apps/web/lib/utils/comments.ts, slack.ts). Two small correctness bugs in text handling:

1. MENTION_PATTERN = /@([a-z0-9_]{3,30})/gi (comments.ts:4) matches anywhere, including inside emails/words. A comment 'reach me at mika@storylane.dev' makes extractMentions return ['storylane']; a member named storylane gets a false 'you were mentioned' notification (notifications.ts:47) and parseCommentBody renders the middle of the email as a mention chip. Fix: require start-of-string or a non-word char before @ (e.g. /(?<![\w@])@([a-z0-9_]{3,30})/gi).

2. storyStateChangeMessage (slack.ts:9) interpolates story title/status into Slack text without escaping Slack's control chars &, <, >. notifySlack (lib/integrations/slack.ts:36) posts it raw as { text }. A story titled 'Render <UserList> & fix' renders mangled in Slack (< > is link/mention syntax). Same for custom status names in dropStoryFree. Fix: escape &->&amp; <->&lt; >->&gt; before building the message.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 extractMentions/parseCommentBody do not treat @handle inside an email or word as a mention; existing mention cases still work
- [x] #2 Slack message text escapes &, <, > for story titles and custom status names
- [x] #3 Tests cover email-in-comment (no false mention) and a title containing & < >
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Followed systematic-debugging: reproduced both bugs directly by reading the flagged code (comments.ts MENTION_PATTERN, slack.ts storyStateChangeMessage, notifySlack), confirmed root cause matched the task description exactly, wrote failing tests first (TDD), then applied the minimal fix.

1. MENTION_PATTERN gained a negative lookbehind (?<![\w@]) requiring start-of-string or a non-word/non-@ char before @ - the exact fix the task description suggested. Verified extractMentions/parseCommentBody no longer produce a false mention from mika@storylane.dev, while every existing mention case (start-of-string, mid-sentence, back-to-back mentions separated by a space, lowercasing) still passes.

2. Added escapeSlackText (escapes & first, then < and >, in that order so the &amp; this function introduces for < / > is never itself re-escaped) and applied it to both story.title and the newState parameter of storyStateChangeMessage - the latter also covers custom status names, since dropStoryFree (board/actions.ts:260) passes status.name through that same parameter. iterationDoneMessage/iterationStartedMessage only interpolate numbers/dates, no escaping needed there. Confirmed extractMentions/notifications.ts (the only other consumer) shares the same single extractMentions implementation - no duplicate regex existed elsewhere to fix.

No live/DB verification needed - both are pure, side-effect-free functions with full unit coverage; no RLS/UI surface touched.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed two small correctness bugs found in the 2026-07-08 code review: the @mention regex had no left boundary, so an email like mika@storylane.dev produced a false mention on "storylane"; and Slack message text was interpolated raw, so a story title or custom status name containing &, <, or > rendered mangled in Slack. Both fixed with a minimal, targeted change (a lookbehind on the mention regex; an escape helper applied before building the Slack message) and covered by new unit tests written first (TDD) to prove the bug before fixing it.
<!-- SECTION:FINAL_SUMMARY:END -->
