# Storylane — Phase 1 Task List

Reference `SPEC.md` for data models, RLS policies, and feature details.

> **2026-07-07 より、新規の作業タスクは Backlog.md（`backlog` CLI）で管理する。**
> このファイルは「残作業の索引」と「iOS 展開の控え」のみ。
> 完了済みタスク（Tasks 1〜15 の Web 実装）の経緯は `TASK_ARCHIVE.md` — 履歴が必要な時だけ読むこと。

## 開発順序方針（2026-07-01 変更）

**Web を全タスク実装し終えてから iOS に着手する。**
理由: Web で仕様変更が発生することがあり、Web 実装を先に安定させてから iOS を実装する方が手戻りを最小化できる。

## 残作業（Web）

- **デプロイ + 本番 Webhook 検証** → Backlog **TASK-3**（旧 Task 11.5 + Task 12 の本番実検証。
  アカウント・手順の個人メモは `ACCOUNT_SETUP.md`〈gitignore 済み〉。秘密情報はコミットしない）
- **2026-07-07 要件改訂** → Backlog **TASK-4〜TASK-17**（Tracker 改名 / Projects ページ刷新 /
  アカウント設定 / Backlog グループ表示 / 手動 Finish / autosave / Epic 昇格 / Move・Copy /
  Focus ビュー / Free モード KanbanFlow 拡張 / スイッチャー改善。spec 反映済み）
- **Task 13 の残スコープ**（今回ラウンド対象外と owner 確認済み、未計画）:
  レスポンシブ対応 / アクセシビリティ監査 / パフォーマンスレビュー

## iOS（Web 全タスク完了後に着手 — 各タスクの Web 実装経緯は TASK_ARCHIVE.md 参照）

- Task 6: `IterationsView`（一覧 / current iteration 詳細 / goal 表示・編集）
- Task 7: `EpicsView`（進捗表示）/ story 編集の label picker
- Task 9: `StoryDetailView` のコメント一覧・入力 / Activity ログ画面
- Task 10: APNs push 通知 — **保留（当面なし）**: Apple Developer Program（$99/年）登録後に着手。
  それまで通知は Web のブラウザ通知のみ
- Task 12.5: 新ライフサイクル（unscheduled 含む）・自動ロールオーバー対応 / Icebox 表示 /
  カード上の状態遷移ボタン / タスク（チェックリスト）UI
- Task 13: エラー・空状態 / ローディング / a11y（VoiceOver・Dynamic Type）/ パフォーマンス
- Task 14 / 15 / 2026-07-07 要件改訂分: Web 確定後にスコープ確認
