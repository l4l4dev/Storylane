---
id: TASK-17
title: Project switcher polish
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-07 14:29'
updated_date: '2026-07-10 23:59'
labels:
  - web
milestone: m-0
dependencies:
  - TASK-8
references:
  - spec/screens.md
priority: low
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The sidebar project switcher already exists (app-sidebar.tsx) but the owner didn't discover it — it reads as a label, not a control. Per spec/screens.md 'Project switcher': add a chevron affordance, list favorites first with pin icons, show each project's mode badge, and exclude archived projects.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Switcher trigger shows a visible chevron and hover state so it reads as a control
- [x] #2 Dropdown lists favorites first with a pin icon, shows mode badges, and excludes archived projects
- [x] #3 Component test covers ordering and archived exclusion
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#1(chevron+hover)は既存実装(ChevronsUpDown + Button variant=outline の hover:bg-muted)で満たされていたため変更なし。AC#2: app-sidebar.tsx の ProjectRef に workflowMode/isArchived を追加し、archived を除外するフィルタ(サーバー側の archived_at フィルタに加えて防御的にコンポーネント側でも実施)、favorite に Pin アイコン、Tracker/Free モードバッジ(project-card.tsx と同じ Badge variant 規約)を追加。layout.tsx で workflow_mode を取得しマッピング。AC#3: app-sidebar.test.tsx にピン表示・モードバッジ・archived除外の3テストを追加(TDDでRED確認後に実装)。pnpm test 345 passed / pnpm build 成功 / web-conventions-reviewer でクリーンなレビュー確認済み。
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-10 23:39
---
Note 2026-07-11: TASK-31 AC #1 (pin icon in the switcher dropdown) is a subset of this task's AC #2. Pick up TASK-31 in the same session after this one.
---
<!-- COMMENTS:END -->
