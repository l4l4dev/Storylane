---
id: TASK-40
title: >-
  Show status-change history on the story detail panel (and record free-mode
  column moves)
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 05:18'
updated_date: '2026-07-11 06:37'
labels:
  - web
  - db
  - feature
dependencies: []
priority: medium
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11: 'keep a history of status changes'. The DB already records tracker state changes — supabase/migrations/20260702000001_username_activity_triggers.sql writes 'story.state_changed' {from,to} rows to activity_logs — but they are only visible on the project Activity page, not on the story itself.

1. Story detail panel (apps/web/components/features/story/story-detail-panel.tsx): add a History section listing that story's activity_logs (state changes at minimum; who + when, dates per the shared formatter).
2. Verify free mode: column moves change stories.custom_status_id, which the existing trigger does NOT log (it watches state). Extend the trigger to record custom-status moves (e.g. 'story.column_changed' with from/to column names). Trigger change = migration; activity/event path, so keep the single-recording-path rule (clients never insert activity_logs) and run rls-security-reviewer on the migration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Story detail shows a chronological history of its status/column changes with actor and timestamp
- [ ] #2 Free-mode column moves are recorded in activity_logs via trigger
- [ ] #3 Tests cover history rendering; migration reviewed for RLS
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow spec/ux-principles.md (landed with TASK-46) for the history section's presentation (design language, dates). End with a fable-advisor design review before manual verification.
<!-- SECTION:NOTES:END -->
