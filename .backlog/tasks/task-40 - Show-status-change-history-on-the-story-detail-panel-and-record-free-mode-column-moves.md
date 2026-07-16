---
id: TASK-40
title: >-
  Show status-change history on the story detail panel (and record free-mode
  column moves)
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 05:18'
updated_date: '2026-07-16 23:49'
labels:
  - web
  - db
  - feature
milestone: m-0
dependencies: []
priority: medium
ordinal: 700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11: 'keep a history of status changes'. The DB already records tracker state changes — supabase/migrations/20260702000001_username_activity_triggers.sql writes 'story.state_changed' {from,to} rows to activity_logs — but they are only visible on the project Activity page, not on the story itself.

1. Story detail panel (apps/web/components/features/story/story-detail-panel.tsx): add a History section listing that story's activity_logs (state changes at minimum; who + when, dates per the shared formatter).
2. Verify free mode: column moves change stories.custom_status_id, which the existing trigger does NOT log (it watches state). Extend the trigger to record custom-status moves (e.g. 'story.column_changed' with from/to column names). Trigger change = migration; activity/event path, so keep the single-recording-path rule (clients never insert activity_logs) and run rls-security-reviewer on the migration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Story detail shows a chronological history of its status/column changes with actor and timestamp
- [x] #2 Free-mode column moves are recorded in activity_logs via trigger
- [x] #3 Tests cover history rendering; migration reviewed for RLS
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow spec/ux-principles.md (landed with TASK-46) for the history section's presentation (design language, dates). End with a fable-advisor design review before manual verification.

UX PARITY CHECK (fable-advisor Wayback, 2026-07-17): Pivotal Tracker shows story history in a SEPARATE History panel opened from a clock icon on the story (distinct from comments; dated activity list). Storylane instead renders history as an inline section at the bottom of the story side-peek panel — an intentional divergence (a separate sub-panel inside the side peek would be overkill). Recorded per spec/ux-principles.md before finalizing.

DONE (Opus 4.8, 2026-07-17):
- migration 20260717000003: log_story_activity を拡張、custom_status_id 変更で 'story.column_changed' {from,to}(列名、移動時点で解決)を記録。UPDATE 分岐を state/custom_status 独立の if に。ベースは 20260702000001 verbatim。
- describeActivity に story.column_changed ケース(null 列は 'no column')。
- getStoryDetail に history 取得追加(action フィルタ ['story.created','story.state_changed','story.column_changed'] で comment.added 除外、新しい順 limit 50)。activity_logs(story_id) index は TASK-58(20260716000003)で既出。
- StoryDetailPanel にコメント下の History セクション(muted 逆時系列 + formatDateTime、空なら非表示)。describeActivity を storyTitle=detail.title で再利用。
- テスト: activity.test.ts(column_changed + null 列)、story-detail-panel.test.tsx(history 描画/空時非表示)、activity-column-change.integration.test.ts(trigger の column_changed 記録 + comment.added がフィルタで除外されること)。
検証: db reset で全 migration 適用 → 521 pass(統合込み)、tsc 0、eslint 0。trigger を実機確認。
レビュー: rls-security-reviewer=穴なし(grant/null/cross-tenant を実測)、fable-advisor design review=修正付き承認(action 無フィルタバグ修正 + storyTitle=null→detail.title + parity finding 記録、すべて対応済み)。
REMAINING: 手動ブラウザ確認(オーナー)。
<!-- SECTION:NOTES:END -->
