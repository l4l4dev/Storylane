---
id: TASK-231
title: Three deferred polish items from TASK-217's reviews
status: In Progress
assignee:
  - '@claude-sonnet-5'
created_date: '2026-08-05 03:22'
updated_date: '2026-08-05 08:01'
labels: []
milestone: m-2
dependencies: []
references:
  - apps/web/app/dashboard/page.tsx
  - apps/web/app/my-work/archive/page.tsx
  - apps/web/components/features/story/split-studio.tsx
  - apps/web/components/features/projects/state-manager.tsx
priority: low
ordinal: 5100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three unrelated-but-small items that TASK-217's review rounds surfaced and deliberately left out of scope. Grouped because each is a few lines and none blocks anything; split them out if one turns out to need real design work.

1. READS THAT DISCARD THEIR ERROR (found by /code-review, 2026-08-04)

`assertReadOk` (apps/web/lib/supabase/assert.ts) exists so a failed Supabase read reaches error.tsx instead of rendering as empty content. Two pages still destructure `const { data } = await ...` and drop the error:
  - apps/web/app/dashboard/page.tsx:32 — the projects list
  - apps/web/app/my-work/archive/page.tsx:26, 32, 37 — profile row, projects, project_states

Both degrade to an empty list rather than a wrong 404, which is why they were not fixed alongside the two that mattered: the activity feed (whose discarded error hid an ambiguous PostgREST embed for weeks, so it rendered 'No activity yet.' on every live load) and getStoryDetail (whose `.single()` + discarded error reported a failed read as a deleted story). Those two are fixed; these four call sites are the remainder.

Note the helper's own rule when fixing: an existence check must use `.maybeSingle()`, not `.single()`, or a legitimate RLS-filtered zero rows becomes a thrown error. archive/page.tsx:27 currently uses `.single()`.

2. SPLIT STUDIO'S HINT SHIFTS THE LAYOUT (found by fable-advisor, 2026-08-04)

apps/web/components/features/story/split-studio.tsx:160-162 renders 'Select text above to extract it as a new story.' only while nothing is selected, so it appears and disappears as the user selects text — pushing the Tasks section below it up and down. spec/ux-principles.md #3 wants the space reserved instead (min-h on the container, or visibility rather than conditional rendering). Pre-existing; not introduced by the selection-clipping fix that prompted the review.

3. ICON-XS TOUCH TARGETS (found by fable-advisor, 2026-08-04)

The `icon-xs` buttons in apps/web/components/features/projects/state-manager.tsx — the reorder chevrons (2 per state row) and the delete X — are below a comfortable touch size. Raised during the 375px responsive review, where those rows now wrap onto two lines on a phone, so they are genuinely touched there. spec/ux-principles.md #7 covers touch sizing. Check whether other `icon-xs` sites share the problem before changing the variant itself: a blanket change to the Button variant would affect every icon-xs in the app, which may not be wanted.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The four reads in dashboard/page.tsx and my-work/archive/page.tsx go through assertReadOk, with the existence check switched to maybeSingle so an RLS-filtered zero rows still renders as empty rather than throwing
- [x] #2 A test covers that a failed read on one of those pages surfaces rather than rendering as empty content
- [x] #3 Split Studio's selection hint no longer moves the Tasks section when the selection changes
- [x] #4 The state-manager reorder and delete controls meet the touch-target size in spec/ux-principles.md #7 at 375px, and the decision on whether to change the icon-xs variant globally or only these sites is recorded
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
fable-advisor design review (2026-08-05): 2件とも承認、修正指示なし。
- Split Studio ヒント常時マウント+invisible切り替え: principle #3 充足、a11y上も問題なし(visibility:hiddenはaccessibility treeから除外、aria-hidden追加は不要)。
- state-manager icon-xs→icon-sm(3箇所ローカル): my-work-sections.tsx(TASK-150)に同型の前例あり。他のicon-xs使用箇所(10ファイル)への横展開は不要 — house density方針のマウスchromeはicon-xsのまま、375pxで実際にタップ主経路になる箇所のみper-siteでicon-smに上げるのがこのプロジェクトの確立ルール。variant自体の一括変更は見送り(density方針と衝突するため)。
決定事項: 他のicon-xs使用箇所は横展開しない。今後375pxでタップ主経路になる箇所が見つかった場合のみ個別にicon-smへ上げる。

検証: pnpm test 929 passed(新規テスト2件: dashboard/page.test.tsx の失敗read検証、split-studio.test.tsx のヒント常時マウント検証)。pnpm run lint exit 0(既存warning1件のみ、TASK-231とは無関係)。

/code-review (2026-08-05) の指摘4件に対応:
1. dashboard/page.tsx の iterationsResult/membersResult も同じ discarded-error パターンだったため assertReadOk化(オーナー承認によりスコープ拡大)。
2. my-work/archive/page.tsxの3読み取りに対する回帰テスト追加(page.test.tsx新規作成)。
3. split-studio.tsx のhasBlankTitleヒントも同じレイアウトシフト問題だったため、選択ヒントと同じ常時マウント+invisible切り替えパターンで修正(オーナー承認によりスコープ拡大)、回帰テスト追加。
4. dashboard/page.test.tsx の履歴叙述コメントをCode Comment Policy違反のため削除。
再検証: pnpm test 931 passed、pnpm run lint exit 0(既存warning1件のみ)。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
TASK-217レビューから繰り延べた3件を実装。(1) dashboard/page.tsx・my-work/archive/page.tsxの4箇所の読み取りをassertReadOk経由に変更、既存check(.single()→.maybeSingle())も修正、失敗readが表面化することをdashboard/page.test.tsxで検証。(2) split-studio.tsxの選択ヒントを条件付きレンダリングから常時マウント+invisible切り替えに変更、Tasksセクションのレイアウトシフトを解消、split-studio.test.tsxで固定。(3) state-manager.tsxの並び替え/削除ボタンをicon-xs→icon-sm(3箇所ローカル)に変更、他のicon-xs使用箇所への横展開はなし。UI変更(2)(3)はfable-advisorのdesign review承認済み(2026-08-05、修正指示なし)。pnpm test 929 passed、pnpm run lint exit 0(既存warning1件のみ、無関係)。advisorが指摘したmy-work-column-manager.tsxの類似候補はTASK-94のACに追記(スコープ外)。
<!-- SECTION:FINAL_SUMMARY:END -->
