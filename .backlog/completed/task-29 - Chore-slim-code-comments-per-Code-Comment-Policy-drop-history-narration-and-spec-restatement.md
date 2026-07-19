---
id: TASK-29
title: >-
  Chore: slim code comments per Code Comment Policy (drop history narration and
  spec restatement)
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-10 14:34'
updated_date: '2026-07-11 00:33'
labels:
  - web
milestone: m-0
dependencies:
  - TASK-8
priority: low
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to the Code Comment Policy added to CLAUDE.md on 2026-07-10. Existing comments in apps/web are inflated by two patterns the policy now bans: task-history narration ("TASK-19 changed this...", "this used to...") and spec restatement (paragraphs copied from spec/*.md instead of a section reference). Short constraint / why-not comments STAY — they are cross-session context this project relies on. Comment-only change: no code behavior may change. Biggest offenders by inspection: app/projects/[id]/board/actions.ts, lib/utils/iterations.ts, app/projects/[id]/settings/actions.ts, lib/utils/kanban.ts, app/projects/[id]/board/page.tsx. Depends on TASK-8 because it touches settings/actions.ts, which TASK-8 is editing in parallel.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Comments in apps/web contain no task-history narration and no spec restatement; spec references remain as section pointers only
- [x] #2 Short constraint / why-not comments are preserved
- [x] #3 The diff touches only comments (and doc comments) — no executable code changes
- [x] #4 pnpm test passes unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
指定5ファイル(board/actions.ts, settings/actions.ts, board/page.tsx, lib/utils/iterations.ts, lib/utils/kanban.ts)に加え、apps/web全体をgrepで洗い出し、TASK番号引用タグ(全46ファイル)と履歴語りセンテンス(used to/previously/replaces the old等)を全て除去(the owner承認のうえ範囲拡大)。短い constraint/why-not コメントは維持、spec参照はセクションポインタのみに整理。自分がこのセッション中にTASK-26/TASK-31で追加した lib/supabase/assert.ts のTASK参照も同様に修正。diff は git diff で全行を機械チェックし、コメント/JSXコメント行以外の変更がないことを確認(コード挙動変更なし)。pnpm test 351 passed(変更前と同数)/ tsc --noEmit クリーン / pnpm build 成功。
<!-- SECTION:NOTES:END -->
