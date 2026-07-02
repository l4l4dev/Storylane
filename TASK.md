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

- [ ] Subscribe to story changes via Supabase Realtime on backlog and iteration views
- [ ] Reflect story state changes live without page refresh
- [ ] Show live comment updates on story detail

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
- [ ] Board をマルチパネル横並びレイアウトに再構築
      （左サイドバーで Current / Backlog / Icebox / Done / Epics パネルをトグル — see spec/screens.md）
- [ ] Icebox パネル（unscheduled ストーリーの一覧。Backlog へドラッグすると unstarted に昇格）
- [ ] ストーリーカード上のワンクリック状態遷移ボタン（Start / Finish / Deliver / Accept / Reject / Restart）
      — 次の有効な遷移のみ提示するステートマシン。詳細画面の自由な state select も廃止して置き換える
      （カード上のボタン実装は完了。`/stories/[id]` の select 廃止はステップ7のインライン展開で行う）
- [ ] Iteration 自動スケジューリング: velocity に基づき Backlog を iteration 境界マーカーで自動分割
      （「Generate next iteration」ボタンを廃止 — see spec/velocity.md）
- [ ] Iteration 自動ロールオーバー: end_date 経過後の初回アクセスで velocity を確定し、
      未 accepted ストーリーを次 iteration へ持ち越す（「Mark as done」ボタンを廃止）
- [ ] ストーリー詳細のパネル内インライン展開（アコーディオン。`/stories/[id]` はディープリンク用に残す）
- [x] ポイント入力をプロジェクトの point scale からの選択式にする（自由数値入力を廃止）
- [x] 未見積もりの `feature` は Start 不可にする
- [x] `release` ストーリーをマイルストーンマーカー行（旗 + 罫線）として描画
- [x] accepted ストーリーのカードを緑背景で表示
- [x] カード全体をドラッグ可能にする（⠿ ハンドル限定をやめる）
- [x] ポイント表示: 3 以下はドット（•）、それより大きい値は数字
- [ ] ストーリー詳細にタスク（チェックリスト）UI を追加
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
