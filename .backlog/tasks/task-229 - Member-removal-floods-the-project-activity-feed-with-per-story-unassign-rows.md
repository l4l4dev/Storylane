---
id: TASK-229
title: Member removal floods the project activity feed with per-story unassign rows
status: To Do
assignee:
  - '@claude-opus-5'
created_date: '2026-08-03 14:27'
labels: []
milestone: m-2
dependencies: []
priority: medium
ordinal: 1800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Removing a project member unassigns every story they held, via the composite FK's ON DELETE SET NULL (20260730030000). Since TASK-224 those UPDATEs are logged, so a member holding 30 stories produces 30 story.assignee_changed rows in one transaction, all rendering as `Owner unassigned "..." from Rin`.

apps/web/app/projects/[id]/activity/page.tsx pages 20 rows at a time, so one removal buries a page and a half of real history. This is the readability failure TASK-225 was filed for, in a new place.

The owner ruled (2026-08-03) that the rows stay as they are for now: they are true, and "these 30 stories need a new owner" is exactly what a team must learn from a removal. TASK-224 shipped that way deliberately — being noisy is strictly better than the silence it replaced.

Why the TASK-225 marker does not simply solve it: storylane.bookkeeping hides a row from BOTH the project feed and the story-detail panel. Story detail is where "why did this story lose its assignee?" gets answered, so hiding it there re-creates half of the bug TASK-224 just fixed. The two readers want different things from the same rows, which the marker cannot express.

So the fix is a feed-side collapse, not suppression — e.g. the feed groups a run of rows sharing (action, actor, transaction) into one entry ("Owner removed Rin, unassigning 30 stories") while every other reader keeps the individual rows. Note TASK-225 rejected time-window grouping as a heuristic; since 20260802000000 rows carry distinct clock_timestamp values, so grouping needs an explicit shared key, not a timestamp window.

Decide the shape before implementing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A decision is recorded on how the feed groups the cascade rows, and why that key rather than a timestamp window
- [ ] #2 Removing a member holding N stories produces one entry in the project activity feed, not N
- [ ] #3 The story-detail panel of each affected story still shows its own unassignment — the collapse is feed-only
- [ ] #4 Every other activity_logs reader (MCP get_story, burndown) is unaffected, and checked
- [ ] #5 A test covers a multi-story member removal end to end
<!-- AC:END -->
