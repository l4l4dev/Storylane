# Storylane — Phase 1 Task List

Implementation tasks for Phase 1. Work through them in order.
Each task should be completed with tests before moving to the next.

Reference `SPEC.md` for data models, RLS policies, and feature details.

> 完了済みセクション（Tasks 1〜5・8、および Task 6/7/9 の DB・Web 部分）は
> `TASK_ARCHIVE.md` に移動した。完了タスクの経緯が必要な時だけ読むこと。

## 開発順序方針（2026-07-01 変更）

**Web を全タスク実装し終えてから iOS に着手する。**
理由: Web で仕様変更が発生することがあり、Web 実装を先に安定させてから iOS を実装する方が手戻りを最小化できる。
Tasks 6〜13 は Web → iOS の順で進める。

---

## Task 6 — Iterations（Web ✅ → TASK_ARCHIVE.md）

> Web 実装の手動 iteration 運用は Task 12.5 の自動スケジューリング + 自動ロールオーバーに置き換える。

### iOS（Web 全タスク完了後に着手）
- [ ] `IterationsView` — list of iterations
- [ ] Current iteration detail with story list
- [ ] Sprint goal display and edit

---

## Task 7 — Epics & Labels（Web ✅ → TASK_ARCHIVE.md）

### iOS（Web 全タスク完了後に着手）
- [ ] `EpicsView` — epic list with progress
- [ ] Label picker in story edit screen

---

## Task 9 — Collaboration: Comments & Activity（DB・Web ✅ → TASK_ARCHIVE.md）

### iOS（Web 全タスク完了後に着手）
- [ ] Comment list and input on `StoryDetailView`
- [ ] Activity log screen

---

## Task 11 — Realtime Collaboration

> **順序変更（2026-07-02）**: Task 10（通知）より先に実施する。
> ブラウザ通知のトリガーは Realtime のイベント購読が前提のため（番号は既存参照を壊さないよう維持）。
> また **Task 12.5（board 再構築）の後に実施する** — 購読を配線する board のビューが
> Task 12.5 で作り直されるため、先に配線すると手戻りになる。

- [x] Subscribe to story changes via Supabase Realtime on backlog and iteration views
- [x] Reflect story state changes live without page refresh
- [x] Show live comment updates on story detail

---

## Task 10 — Notifications（Task 11 の後に実施）

> 通知のイベント源は Task 11 で導入する Realtime 購読を使う（購読したイベントから Notification API を発火する）。

### Web ✅
- [x] Request browser notification permission on sign-in
- [x] Trigger notification on: assigned to story, @mentioned, story state changed
      （`lib/utils/notifications.ts` の純関数 + `useNotificationsRealtime`
      〈`lib/supabase/realtime.ts`〉+ `NotificationListener`〈root layout に配置〉。
      既知の簡略化: 自分自身の操作による変更も通知される — actor 判定は行っていない）

### iOS（Web 全タスク完了後に着手）
> **保留（当面なし）**: iOS プッシュ通知(APNs)は当面実装しない（シミュレータのみで開発するため）。
> APNs には Apple Developer Program（有料・$99/年）が必要。実装する場合はその登録後に着手する。
> それまでは Web のブラウザ通知のみを提供する。

- [ ] Register for push notifications (APNs)
- [ ] Handle notification payloads
- [ ] Trigger push on: assigned to story, @mentioned, story state changed

---

## Task 11.5 — Deployment（Task 12 の前に実施）

> Task 12 の Webhook 検証には公開 URL（デプロイ済み Edge Function）が必要なためここで行う。
> アカウント・手順の詳細は `ACCOUNT_SETUP.md`（gitignore 済み・個人用メモ）を参照。秘密情報はコミットしない。

- [ ] Supabase hosted プロジェクトへ migration を適用（`supabase db push`）
- [ ] Vercel へ Web をデプロイ（Root Directory `apps/web`、Node 22、環境変数設定）
- [ ] 本番 URL を Supabase の Site URL / Redirect URLs と OAuth 設定に追加
- [ ] 本番環境でログイン → プロジェクト作成 → ボード操作の疎通確認

---

## Task 12 — Integrations（Web 実装・ローカル検証 2026-07-07 完了。本番 Webhook 実検証は Task 11.5 後）

### 前提（DB — Web 実装の前に行う）
- [x] Migration: `stories.number`（プロジェクト毎の連番、採番トリガー + UPDATE 不変ピン）を追加
      （see spec/data-model.md。service_role への DML grant 漏れも `20260707000006` で修正）
- [x] ストーリーカード / 詳細画面に `#123` を表示（PR タイトルに書けるようにする）

### GitHub
- [x] Integration setup in project settings (repo URL, webhook secret) — owner 専用セクション、
      コピー用 Webhook URL 表示付き（`integration-settings.tsx`）
- [x] Supabase Edge Function to receive GitHub webhook（`supabase/functions/git-webhook/`、
      HMAC-SHA256 署名検証・timing-safe 比較・`verify_jwt = false`）
- [x] Parse PR title / branch name for story ID（`[SL-123]` / `storylane/123`）
- [x] Auto-update story state to `finished` on PR merge（強制遷移 + iteration 未所属なら
      current へアサイン — 決定事項は spec/integrations.md）
- [ ] 本番デプロイ後、実リポジトリの Webhook で疎通確認（Task 11.5 で実施）

### Slack
- [x] Integration setup in project settings (Incoming Webhook URL)
- [x] Notify on: story state change, iteration start/done（`after()` + `lib/integrations/slack.ts`、
      fire-and-forget。ローカル HTTP リスナーで受信確認済み）
- [x] ~~Edge Function to POST to Slack~~ → **server action から直接 POST に変更**
      （2026-07-07 owner 決定 — spec/integrations.md 参照。owner 専用の integrations 行は
      `lib/supabase/admin.ts`〈service role〉で読む）

### Forgejo
- [x] Reuse GitHub webhook handler（`X-Gitea-Event` / `X-Gitea-Signature`〈プレフィックスなし HMAC〉で
      provider 判別・検証分岐 — curl でローカル検証済み）
- [x] Integration setup in project settings

---

## Task 12.5 — Pivotal Tracker UX Parity

> 2026-07-02 の本家 Pivotal Tracker との乖離調査に基づく修正。仕様の詳細は
> spec/screens.md（Board layout / Story card UX）、spec/features.md、spec/velocity.md を参照。
> Task 6 の手動 iteration 運用はこのタスクで置き換える。
>
> **実施順（2026-07-02）**: Task 9 の後、**Task 11（Realtime）より先に**実施する。
> Realtime の購読対象はこのタスクで再構築する board のビューなので、先に board を
> 作り直した方が手戻りがない（番号は既存参照を壊さないよう 12.5 のまま維持）。
>
> **推奨実装順**（各ステップで実装 + テスト → web-conventions-reviewer でレビュー →
> 検証手順を提示し、ユーザーのコミット許可を得てから次へ。migration を含むステップは
> rls-security-reviewer も実行する）:
> 1. DB 前提 migration 2 件 + `supabase gen types typescript --local > apps/web/lib/database.types.ts`
> 2. ステートマシン util（`apps/web/lib/utils/story-state.ts` を新規作成 — 純関数 + テスト。
>    遷移表は spec/screens.md「Story card UX」参照）
> 3. カード改修: 状態遷移ボタン / accepted 緑背景 / release マーカー行 / ポイントのドット表示 /
>    カード全体ドラッグ（`components/features/board/story-card.tsx`、`sprint-board.tsx`）
> 4. ポイントをスケール選択式に + 未見積もり feature の Start 不可
>    （`lib/utils/stories.ts` の `parsePoints` 拡張、`create-story-dialog.tsx`、`app/stories/[id]/`）
> 5. マルチパネルレイアウト + Icebox パネル（`app/projects/[id]/board/`、`sprint-board.tsx` 再構築）
> 6. 自動スケジューリング境界マーカー + lazy ロールオーバー
>    （`lib/utils/iterations.ts` 拡張、`board/actions.ts` — 手動ボタン 2 つを廃止）
> 7. ストーリー詳細のインライン展開（フィールド・状態ボタン・タスク・コメントを含む）
> 8. タスク（チェックリスト）UI（`components/features/story/` に追加。手順 7 より前倒し可）

### 前提（DB — Web 実装の前に行う）
- [x] Migration: `stories.state` に `'unscheduled'`（Icebox）を追加し、新規ストーリーのデフォルトにする
      （既存行は `unstarted` のまま Backlog に残す — see spec/data-model.md）
- [x] Migration: 未来の `planned` iteration 行を削除し、所属ストーリーを backlog 先頭に相対順を保って戻す
      （future iteration は DB 行ではなく仮想マーカーになるため — see spec/velocity.md）

### Web
- [x] Board をマルチパネル横並びレイアウトに再構築
      （左サイドバーで Current / Backlog / Icebox / Done / Epics パネルをトグル — see spec/screens.md）
- [x] Icebox パネル（unscheduled ストーリーの一覧。Backlog へドラッグすると unstarted に昇格）
- [x] ストーリーカード上のワンクリック状態遷移ボタン（Start / Finish / Deliver / Accept / Reject / Restart）
      — 次の有効な遷移のみ提示するステートマシン。詳細画面の自由な state select も廃止して置き換える
- [x] Iteration 自動スケジューリング: velocity に基づき Backlog を iteration 境界マーカーで自動分割
      （「Generate next iteration」ボタンを廃止 — see spec/velocity.md）
- [x] Iteration 自動ロールオーバー: end_date 経過後の初回アクセスで velocity を確定し、
      未 accepted ストーリーを次 iteration へ持ち越す（「Mark as done」ボタンを廃止）
- [x] ストーリー詳細のパネル内インライン展開（アコーディオン。`/stories/[id]` はディープリンク用に残す）
- [x] ポイント入力をプロジェクトの point scale からの選択式にする（自由数値入力を廃止）
- [x] 未見積もりの `feature` は Start 不可にする
- [x] `release` ストーリーをマイルストーンマーカー行（旗 + 罫線）として描画
- [x] accepted ストーリーのカードを緑背景で表示
- [x] カード全体をドラッグ可能にする（⠿ ハンドル限定をやめる）
- [x] ポイント表示: 3 以下はドット（•）、それより大きい値は数字
- [x] ストーリー詳細にタスク（チェックリスト）UI を追加
      （spec/features.md に Phase 1 として記載済みだが本タスクリストから漏れていた。`tasks` テーブルは作成済み）

### iOS（Web 全タスク完了後に着手）
- [ ] `BacklogView` / `IterationsView` を新ライフサイクル（unscheduled 含む）と自動ロールオーバーに対応
- [ ] Icebox 表示（タブまたはセクション）
- [ ] カード上の状態遷移ボタン（スワイプアクションも新ステートマシンに合わせる）
- [ ] `StoryDetailView` にタスク（チェックリスト）UI

---

## Task 13 — Polish & QA

> 2026-07-07: Backlog TASK-2 の AC は本セクションの6項目のうち3つ（エラー/空状態・
> スケルトン・Playwright E2E）に絞られていることを owner に確認済み。以下その3つを実施。
> レスポンシブ・a11y監査・パフォーマンスレビューは本ラウンドでは未着手（別途スコープ判断）。

### Web
- [x] Error states and empty states for all views（`components/ui/error-state.tsx` +
      `error.tsx` を app/・app/projects/・app/projects/[id]/・app/stories/[id]/ に配置。
      board の「ゼロストーリー/ゼロカラム」空状態も追加。既存の empty state 文言はそのまま）
- [x] Loading skeletons on data-fetching screens（`components/ui/skeleton.tsx` + 7ルートに
      `loading.tsx`）
- [ ] Responsive layout (mobile and desktop)
- [ ] Accessibility audit (keyboard navigation, screen reader labels)
- [x] Playwright を導入し、コアフローの E2E テストを作成（create project → add story →
      complete iteration）。`apps/web/e2e/core-flow.spec.ts`、`pnpm test:e2e`。ローカルで
      1回はクリーンに成功（16.8秒）を確認済みだが、この開発機は load average が高いタイミングが
      あり、その際は dev サーバー側の応答が大きく遅延することがある（アプリのバグではなく環境要因、
      playwright.config.ts にコメントあり）
- [ ] Performance review (query optimization, Realtime subscription cleanup)
- [x] （Task 13 送りだった）dnd-kit の hydration mismatch 警告を修正（`DndContext` に
      安定した `id` を付与 — `kanban-columns-board.tsx` / `board-list-view.tsx` /
      `free-board.tsx`）

### iOS（Web 全タスク完了後に着手）
- [ ] Error states and empty states for all views
- [ ] Loading indicators on data-fetching screens
- [ ] Accessibility audit (VoiceOver labels, Dynamic Type)
- [ ] Performance review (query optimization, Realtime subscription cleanup)

---

## Task 14 — Custom Workflow Modes（2026-07-07 依頼、スコープ確定済み・実装待ち）

> 2026-07-06 のカンバン UI 刷新（状態カンバン化、`spec/screens.md` "Board layout"）の直後に
> owner から依頼。**プロジェクト作成時にワークフローモードを選択**できるようにする:
>
> - **Pivotal Tracker モード（既定・現状維持）**: 固定ステートマシン
>   (`lib/utils/story-state.ts` / `lib/utils/kanban.ts` の `evaluateDrop`)。前進遷移のみ、
>   飛び級不可。List/Kanban 両ビュー（Task 15）はこのモードの実装。
> - **Free モード（新規）**: Trello ライクに **ステータス（カラム）を自由に追加・削除・並び替え・
>   リネーム**でき、**カード移動も任意のステータス間で自由**（前進/後退/飛び級すべて許可）。

### スコープ決定（2026-07-07 owner 確定）
- Free モードは **iteration / velocity なしの純粋な Trello ボード**
  （iteration bar・自動ロールオーバー・velocity 計算・backlog 自動分割はすべて非表示/非動作）
- Free モードでも **points は使う（任意入力）** — カードにバッジ表示のみ、velocity 計算はしない
- ワークフローモードは**プロジェクト作成時に固定**（後から変更不可）
- カスタムステータスに**「完了扱い」フラグ（is_done boolean）を持たせる**
  （Activity ログ・将来のレポートで完了判定に使う）
- 「逆方向遷移だけ許可」の当初案は Free モードに包含され、Pivotal モード内のオプションは作らない
  （仮定として確定 — 異論が出たら再検討）

### 実装スコープ（Web）
- [x] DB: `projects.workflow_mode`（`pivotal` / `free`、default `pivotal`）+
      `custom_statuses` テーブル（project_id・name・color・position・is_done）、migration、RLS
- [x] プロジェクト作成ダイアログにモード選択を追加（作成後は変更不可）
- [x] Web: board のレンダリングをモードで分岐 — Pivotal ＝現状の List/Kanban（無改変）、
      Free ＝ DB 駆動の可変カラムのカンバンのみ（List ビュー・iteration bar・Icebox なし）
- [x] Free 用ドラッグ: 同一プロジェクト内なら任意ステータス間の移動を許可（`evaluateDrop` とは別ルート）
- [x] Web: Settings にステータス管理 UI（追加・削除・並び替え・リネーム・色・is_done）— Free のみ表示
- [x] Free モードのストーリー: points バッジ表示は維持、状態遷移ボタン・iteration 関連 UI は非表示
- [x] tsc / eslint / vitest / pnpm build 通過、ブラウザ実機確認済み（2026-07-07）、
      spec/screens.md・spec/data-model.md 更新済み
- iOS: Web 実装確定後に追随（Web 先行方針、[[project-scope-decisions]]）

---

## Task 15 — Board List View（Pivotal Tracker 本家パリティ、2026-07-07 依頼）

> [dev.classmethod.jp の Pivotal Tracker 紹介記事](https://dev.classmethod.jp/articles/pivotal-tracker-is-good/)
> を踏まえた乖離調査から着手。2026-07-06 のカンバン UI 刷新で、進行中イテレーションのストーリーが
> `Unstarted/Started/Finished/Delivered/Accepted` の物理カラムに分割された結果、本家 Pivotal の
> 「Current + Backlog が1本の縦リストで、状態はカード上のバッジ表現、優先順位＝リスト内の位置」
> という視認性の高い体験が失われた。Task 14（Pivotal モード / Free モード）とは別軸
> （あちらはステータス集合のカスタマイズ、こちらは表示形式）のため別タスクとして切り出す。
> 実装は Sonnet 5。
>
> スコープ外（別件として扱う。着手しない）:
> - リリース目標日に対する遅延警告の可視化
> - ストーリーテンプレート機能

### Web
- [x] ボードツールバーに List / Kanban 表示切替を追加（Kanban が既定）。カンバン描画ロジックは
      `kanban-board.tsx` から `kanban-columns-board.tsx` へ抽出し、`kanban-board.tsx` は
      ヘッダー共通部 + 表示切替のみを持つオーケストレーターに変更（挙動は無改変）
- [x] 新規 `board-list-view.tsx`: 進行中イテレーションの全ストーリー（状態問わず）+ Backlog を
      1本の縦リストで表示。イテレーション区切り線は Current 側にも拡張
      （既存の `splitBacklogIntoVirtualIterations` を流用）
- [x] 新規 `story-list-row.tsx`: 横長・低背のコンパクト行。状態はバッジ（`STORY_STATE_META`）で表現
      （カラム移動なし）
- [x] List 表示用の状態遷移: カラムドロップに依存できないため、行にワンクリック遷移ボタンを表示
      （既存の `TransitionButtons`／`transitionStory` action をそのまま再利用 — 2026-07-02 実装が
      side peek 用に現存していたため新規実装は不要だった）
- [x] List 表示用の並び替え: Current/Backlog/Icebox をゾーンとして扱う DnD ロジック
      （`lib/utils/kanban.ts` に `zoneForStory`/`evaluateListDrop` を追加、`board/actions.ts` に
      `dropStoryInList` を追加。Kanban 用の `evaluateDrop`/`dropStory` は無改変）
- [x] `board-filters.tsx` のフィルタは両表示で共通適用（サーバー側で絞り込み後に両表示へ渡すため自然に共通化）
- [x] `spec/screens.md`「Board layout」に List/Kanban 両表示の仕様を追記
- [x] テスト: `zoneForStory`/`evaluateListDrop`（区切り線ロジックは既存 `splitBacklogIntoVirtualIterations`
      を流用のため既存テストで担保）、`findContainer`/`storyById` 共通ヘルパーの vitest テスト

### Web — 追加改善（2026-07-07 owner 依頼、上記コミット後）
- [x] デフォルト表示を List に変更（`kanban-board.tsx`）
- [x] Kanban 表示を現在の iteration のみに縮小（Backlog 列・Icebox トグル/列を撤去。
      `kanban-columns-board.tsx` から `velocity`/`nextVirtualIterationNumber`/`showIcebox` props も削除。
      `evaluateDrop`/`columnForStory` 自体は無改変）
- [x] List 表示に自由な区切り（divider）機能を追加:
      新規テーブル `backlog_dividers`（migration + RLS、rls-security-reviewer 実施・問題なし）、
      `lib/utils/iterations.ts` に `buildBacklogRows`（ストーリー＋区切り＋自動 Iteration 境界線を
      1本のrow列に補間する純粋関数）、`board/actions.ts` に `createBacklogDivider`/`deleteBacklogDivider`、
      `dropStoryInList` を拡張して divider の並び替え（backlog ゾーン内限定）にも対応
- [x] backlog からイテレーションへ入れた後も戻せる挙動を確認（既存 `evaluateListDrop` の
      「unstarted のみ zone 境界を自由に行き来できる」ルールで対応済み、追加実装なし）
- [x] List 表示の Icebox を独立したサイドカラム表示に変更（`IceboxColumn`、優先順位に集中できるよう
      メインリストから分離）
- [x] spec/data-model.md に `backlog_dividers` を追記
- [x] （フォロー実施 2026-07-07）`backlog_dividers` を Realtime publication に追加し、
      board の購読フックを `useProjectBoardRealtime` に改名して dividers も購読
      （Task 10 のコミット後に `realtime.ts` が解放されたため実施）

### Web — 区切り挿入 UX 改善（2026-07-07 owner フィードバック、上記コミット後）

> フィードバック 3 点: ①区切りが末尾追加→ドラッグでしか置けず任意の場所に追加できない
> ②次の Iteration の追加方法がわかりにくい（手動でも Iteration 区切りを挿入したい）
> ③Add Story ボタンがストーリー行のように見えて主張が強く、アイテム群に集中できない

- [x] ホバー挿入 UI: Backlog の行と行の間にホバーすると「+ Note / + Iteration break」ボタンが
      現れ、その場に挿入できる（`board-list-view.tsx` の `InsertBetweenRows`。
      `createBacklogDivider` に `before_item_id` を追加し、挿入位置で backlog 全体を再採番）
- [x] 手動 Iteration 区切り: `backlog_dividers.kind`（`note`/`iteration_break`）を migration で追加
      （rls-security-reviewer 実施・問題なし）。iteration break を置くとその位置で仮想 iteration が
      強制的に閉じ、以降の番号が振り直される（`buildBacklogRows` を点数累積ウォークに書き換え。
      自動境界線と同じ「Iteration #N」線で描画されるが、手動分はドラッグ・削除（✕）可能）
- [x] Add Story を各セクションヘッダー内の小さなテキストリンクに変更
      （`quick-add-composer.tsx` に `compact` prop。破線ボックスの Kanban 用表示は従来どおり）
- [x] バグ修正: `board/page.tsx` の dividers クエリに `kind` 列が漏れており List 表示が壊れていた
- [x] spec/screens.md「Board layout」を全面更新（List 既定・Kanban 縮小・挿入 UI・手動 break）、
      spec/data-model.md に `kind` 列を追記
- [ ] （Task 13 送り）dnd-kit の hydration mismatch 警告（`aria-describedby` の ID カウンタが
      SSR/クライアントでずれる。aria 属性のみで機能への実害なし。dnd-kit 利用箇所全体の問題）

### iOS（Web 全タスク完了後に着手）
- [ ] 検討事項なし（Web 確定後にスコープ確認）
