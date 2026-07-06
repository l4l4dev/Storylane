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

### Web
- [ ] Request browser notification permission on sign-in
- [ ] Trigger notification on: assigned to story, @mentioned, story state changed

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

## Task 12 — Integrations

### 前提（DB — Web 実装の前に行う）
- [ ] Migration: `stories.number`（プロジェクト毎の連番、採番トリガー）を追加（see spec/data-model.md）
- [ ] ストーリーカード / 詳細画面に `#123` を表示（PR タイトルに書けるようにする）

### GitHub
- [ ] Integration setup in project settings (repo URL, webhook secret)
- [ ] Supabase Edge Function to receive GitHub webhook
- [ ] Parse PR title / branch name for story ID (e.g. `[SL-123]` — `stories.number` ベース)
- [ ] Auto-update story state to `finished` on PR merge

### Slack
- [ ] Integration setup in project settings (Incoming Webhook URL)
- [ ] Notify on: story state change, iteration start/done
- [ ] Edge Function to POST to Slack

### Forgejo
- [ ] Reuse GitHub webhook handler（ペイロードは GitHub 互換だがヘッダー・署名が異なる:
      `X-Gitea-Event` / `X-Gitea-Signature`、HMAC 形式差に注意 — see spec/integrations.md）
- [ ] Integration setup in project settings

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

### Web
- [ ] Error states and empty states for all views
- [ ] Loading skeletons on data-fetching screens
- [ ] Responsive layout (mobile and desktop)
- [ ] Accessibility audit (keyboard navigation, screen reader labels)
- [ ] Playwright を導入し、コアフローの E2E テストを作成（create project → add story → complete iteration）
- [ ] Performance review (query optimization, Realtime subscription cleanup)

### iOS（Web 全タスク完了後に着手）
- [ ] Error states and empty states for all views
- [ ] Loading indicators on data-fetching screens
- [ ] Accessibility audit (VoiceOver labels, Dynamic Type)
- [ ] Performance review (query optimization, Realtime subscription cleanup)

---

## Task 14 — Custom Workflow Modes（2026-07-07 依頼、未着手・要スコープ確定）

> 2026-07-06 のカンバン UI 刷新（状態カンバン化、`spec/screens.md` "Board layout"）の直後に
> owner から依頼。**プロジェクト作成時にワークフローモードを選択**できるようにする:
>
> - **Pivotal Tracker モード（既定・現状維持）**: 固定ステートマシン
>   (`lib/utils/story-state.ts` / `lib/utils/kanban.ts` の `evaluateDrop`)。前進遷移のみ、
>   飛び級不可。今回のカンバン UI はこのモードの実装。
> - **Free モード（新規）**: Trello ライクに **ステータス（カラム）を自由に追加・削除・並び替え・
>   リネーム**でき、**カード移動も任意のステータス間で自由**（前進/後退/飛び級すべて許可）。
>
> 規模が大きく（新テーブル + migration + RLS、board のレンダリングをモード分岐、velocity/
> iteration 計算との整合、Settings のステータス管理 UI 一式）、今回のカンバン刷新セッションとは
> 別タスクとして切り出す。着手前に以下を確定させること（**推測で実装しない** — CLAUDE.md）。

### 未決事項（着手前に owner と確定）
- [ ] Free モードでも velocity / iteration（sprint）の概念は維持するか？
      それとも Free モードは iteration 抜きの純粋な Trello ボード（カード無限・締切なし）か？
- [ ] Free モードでも points / velocity 計算は行うか（story_type 別の点数除外ルールは維持するか）？
- [ ] ワークフローモードはプロジェクト作成後に変更可能か、作成時に固定か？
      （今回の依頼文面は「作成時に設定」なので固定を既定と仮置き）
- [ ] Free モードのカスタムステータスに「done 相当」のようなカテゴリ/フラグを持たせるか
      （Activity ログや将来のレポート機能で「完了扱い」を判定する必要が出た場合に必要）
- [ ] 既存の「逆方向遷移だけ許可」という当初案（Settings トグル、Pivotal モードの部分緩和）は
      Free モードに包含されて不要になるという理解でよいか、それとも別途 Pivotal モード内の
      オプションとしても欲しいか

### 想定スコープ（未決事項確定後に設計）
- DB: `projects.workflow_mode`（`pivotal` / `free`）+ プロジェクト毎カスタムステータス用の
  新テーブル（名前・色・並び順）、migration、RLS ポリシー
- Web: board のカラム描画をモードで分岐（Pivotal ＝現状の `STATE_COLUMNS` 固定、
  Free ＝ DB 駆動の可変カラム）。`evaluateDrop`（`lib/utils/kanban.ts`）は Pivotal 用の現行実装を
  維持しつつ、Free 用に「同一プロジェクト内なら任意遷移許可」の別ルートを用意
- Web: Settings にステータス管理 UI（追加・削除・並び替え・リネーム・色）— Free モードのみ表示
- iOS: Web 実装確定後に追随（Web 先行方針、[[project-scope-decisions]]）
