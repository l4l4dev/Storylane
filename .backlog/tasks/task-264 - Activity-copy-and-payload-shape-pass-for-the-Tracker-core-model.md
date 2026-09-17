---
id: TASK-264
title: Activity copy and payload shape pass for the Tracker core model
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-17 08:46'
labels: []
milestone: m-10
dependencies:
  - TASK-256
priority: medium
type: task
ordinal: 700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the TASK-256 reviews. Activity messages for labels, epics, tasks, comments, blockers, reviews and iteration overrides were written by inference, not from Tracker copy. Payload gaps: comment_create/update_activity copies the full comment text (up to 20000 chars) into message plus original/new values; a built-in to built-in point-scale change rewrites story estimates without per-story trace or updated_at; a calendar move in updateProject deletes iteration overrides without recording them; setArchived writes new_values only; a current_state-driven list relocation records list but not position; owner/follower add/remove activity shape should match updateStory's fold. Check each against docs/reference/tracker-notes/core-model.md section 5 and the corpus, then fix messages and payloads. No 'Pivotal' in product strings.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every activity message is checked against the Tracker corpus, or documented as an assumption in spec/data-model.md
- [ ] #2 Comment activity stores the text once and truncates the message
- [ ] #3 Estimate rewrites and override deletion caused by project settings changes are visible in the activity feed
- [ ] #4 Tests assert the payload shape for each activity kind
- [ ] #5 bun test, lint and typecheck in apps/server are green
<!-- AC:END -->
