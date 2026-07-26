---
id: TASK-191
title: 'List: two-line story rows + epic colour rule'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-24 18:15'
updated_date: '2026-07-25 08:16'
labels:
  - web
milestone: m-6
dependencies: []
documentation:
  - doc-20
type: enhancement
ordinal: 1750
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-20 §4. The single-line List row already overflows (type icon, number, title, state, points, epic, labels, assignee, transition buttons) and the epic chip is rendered `hidden sm:inline`, so epic membership is the first thing to disappear at narrow widths.

Give the row a second line and mark epic members with a left vertical rule in the epic's colour, so a run of siblings reads as one group while scrolling.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Story rows render on two lines: line 1 = type icon / #number / title / transition buttons, line 2 = epic name / state badge / points / labels / assignee
- [x] #2 A story that belongs to an epic shows a left vertical rule in its epic_color; a story with no epic shows no rule
- [x] #3 The epic name is never hidden by viewport width (the hidden sm:inline treatment is gone)
- [x] #4 fable-advisor design review against spec/ux-principles.md before manual verification
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. components/features/board/kanban-board.tsx: add `parentEpicColor: string | null` to
   `BoardStory` next to `parentEpicTitle`.
2. app/projects/[id]/board/page.tsx: thread `parentEpicColor: story.parent_id ?
   (containerById.get(story.parent_id)?.epic_color ?? null) : null` next to
   `parentEpicTitle` in the `cards` map (containerById already carries epic_color from
   the existing containerRows query, no new fetch).
3. components/features/board/story-list-row.tsx: add `parentEpicColor` to the row's local
   prop intersection type. Rework the JSX into two lines inside the existing bordered
   card div (flex-col instead of items-center row):
   - Line 1: type icon + #number + title (still the openPeek button, flex-1) / transition
     buttons + insertMenu (moved out of the button, right-aligned, unchanged from today).
   - Line 2 (flex-wrap, so narrow viewports wrap instead of hiding or overflowing): epic
     name link, state badge, points badge, labels, assignee — all lose their
     `hidden .../sm:` modifiers (points, epic link, labels currently have them; state
     badge and assignee don't).
   - Left rule: when `parentId && parentEpicTitle`, add `border-l-2` +
     `style={{ borderLeftColor: parentEpicColor ?? DEFAULT_EPIC_COLOR }}` (import
     DEFAULT_EPIC_COLOR from lib/utils/epics-list.ts, same fallback the Epics band uses).
     No parent -> no extra class/style, same border as today.
4. Test fixtures needing `parentEpicColor` added alongside existing `parentEpicTitle`:
   story-list-row.test.tsx (baseStory + the epic-link test), board-list-view.test.tsx
   (backlogStory), kanban-board-toolbar.test.tsx (3 fixtures).
5. story-list-row.test.tsx rewrites:
   - Drop/rewrite the "hides secondary chips below sm" test (its premise goes away).
   - Update the long-state-name truncation test's expected classes if line 2's badge
     wrapper changes them.
   - Extend "shows a link back to the parent epic" to assert no `hidden`/`sm:` classes
     remain on the link, and assert the left-rule border style (color match).
   - Extend "omits the epic link for a story with no parent" to also assert no left-rule
     style is applied.
   - Verify the existing 360px-no-overflow test still holds with flex-wrap on line 2.
6. Full suite + lint from apps/web/, then fable-advisor design review against
   spec/ux-principles.md (AC#4, principles 3 and 8) before proposing manual verification.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
fable-advisor design review (AC#4): 承認, no corrections. principle 8: epic membership now dual-encoded (text link + left rule colour), never hidden by width — the mirror duplication with TASK-190's Epics band is doc-20 §3's intended design, not a new issue. principle 3: line 2's flex-wrap variable height is ordinary responsive reflow (line 1's click targets stay fixed-height, unaffected), not the toggle/hover-driven layout shift the principle targets — same category as Kanban cards' existing variable height. Minor non-blocking notes: unbounded label rendering on line 2 (no +N truncation, not specified by doc-20 §4, revisit if it becomes a real problem) and a request to add one manual-verification item: drag-and-drop between rows of differing height (labels/epic presence) at a narrow viewport, to confirm dnd-kit's rect-based hit-testing isn't visually thrown off — added to the verification steps.

/code-review (second full pass, scanned committed TASK-190 + uncommitted TASK-191) findings:
- CONFIRMED bug (fixed): AddEpicButton (board-list-view.tsx) committed a real createEpic RPC
  call on blur instead of discarding, contrary to its own comment claiming DraftStoryCard's
  discard-on-blur convention. Clicking away from a half-typed epic title silently created a
  permanent epic row. Fixed: blur now calls editor.cancel("blur") (discard), matching
  DraftStoryCard/Escape behavior; Enter still commits.
- DRY simplification (fixed): epics-list.ts's bandChildLocation re-implemented
  zoneForStory's icebox/current/backlog branching instead of calling it -- now delegates to
  kanban.ts's zoneForStory (dummy story_type/points, which it ignores), so a future zone-
  boundary change can't drift between the board and the Epics band.
- DRY simplification (fixed): story-list-row.tsx's openPeek duplicated the exact logic
  board-list-view.tsx's useOpenPeek hook was extracted for in the prior review round.
  Moved to a new shared components/features/board/use-open-peek.ts, imported by both files.
- Migration findings (TASK-189, already Done): 2 more folded into TASK-195 as AC#6/#7
  (is_container formula duplicated between derive_is_container/recompute_is_container;
  protect_stories_epic_pinned's role-based rather than allowlist-based SECURITY DEFINER
  exemption).
- Accepted as-is, no action: CONTAINER_ROWS_ZONE_ID etc. staying unused-for-now (TASK-192,
  already documented); every epic/mirror-row defaulting to expanded on first visit (this
  is the SAME default-expanded convention every existing List-view group already uses,
  e.g. Current/Backlog groups -- not a regression introduced here).
- Flagged to the owner, not decided yet: (1) bandChildLocation labels a child stuck in a
  finalized-but-not-done iteration as "Backlog", indistinguishable from a genuinely
  unscheduled story -- doc-20 §3's 4-bucket dot taxonomy has no room for a 5th "stranded"
  category without a product decision; (2) doc-20 §2 describes "pin an existing story as
  an epic" (set_epic_pinned) as a real path, but no task in the 189-194 chain (including
  TASK-193's /epics + Child stories work) builds a UI entry point for it -- the RPC is
  fully built/tested and unreachable from the product today.

Re-verified after fixes: full apps/web suite 793 passed / 250 skipped, lint clean, tsc
clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
List view の StoryListRow を二行レイアウトに再構成(doc-20 §4)。1行目: 種別アイコン/#番号/タイトル/遷移ボタン。2行目: エピック名リンク/状態バッジ/ポイント/ラベル/担当者 — すべて hidden sm:inline 系のブレークポイント非表示を撤廃し、幅に関わらず常時表示(狭い場合は折り返し)。エピックに属するストーリーは左端に epic_color の縦線(border-l-2 + インラインスタイル、epic_color が null なら DEFAULT_EPIC_COLOR にフォールバック)。BoardStory/story-list-row の型に parentEpicColor を追加、board/page.tsx の containerById から算出。

/code-review で実バグ1件検出・修正(AddEpicButton がフォーカスアウトで下書きを破棄せず本当に create_epic を呼んでいた)。DRY簡略化2件(bandChildLocation を zoneForStory に委譲、useOpenPeek を use-open-peek.ts に切り出して StoryListRow と共有)。TASK-189マイグレーションへの追加指摘2件はTASK-195に統合。'既存ストーリーをエピックに昇格' UI導線の欠落はTASK-196としてフォローアップ化。バンドの位置ドットで確定済み未完了ストーリーがBacklog表示になる件は既知の制約として受け入れ。

検証: fable-advisor 設計レビュー承認(principle 3: line1固定高さ・line2の可変高さはKanbanカード同様の通常のリフローでレイアウト崩壊の対象外、principle 8: hidden系撤廃で満たす)。apps/web 全体テスト 793 passed / 250 skipped、lint clean、tsc clean。手動ブラウザ確認は未実施(確認手順を別途提示済み、D&D境界確認を追加)。
<!-- SECTION:FINAL_SUMMARY:END -->
