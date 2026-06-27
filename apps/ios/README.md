# Storylane iOS

Swift / SwiftUI（iOS 17+）アプリ。MVVM + Repository 構成（詳細は ルート `CLAUDE.md`）。

プロジェクトは **XcodeGen** で `project.yml` から生成し、ツールは **Mint** で管理します。
`Storylane.xcodeproj` は生成物のため **コミットしません**（`.gitignore` 済み）。

## セットアップ

```bash
# 1. ツール管理に Mint を導入（未導入の場合）
brew install mint

# 2. apps/ios でツール（XcodeGen / SwiftLint）を取得
cd apps/ios
mint bootstrap

# 3. Xcode プロジェクトを生成
mint run xcodegen generate

# 4. Xcode で開く
open Storylane.xcodeproj
```

`project.yml` を変更したら `mint run xcodegen generate` を再実行してください。

## ツール（Mintfile でバージョン固定）
- **XcodeGen** … `project.yml` から `Storylane.xcodeproj` を生成
- **SwiftLint** … Lint。ビルド時に pre-build script として自動実行。手動は `mint run swiftlint`

## フォルダ構成（CLAUDE.md 準拠）

```
apps/ios/
├── project.yml             # XcodeGen 定義
├── Mintfile                # ツールのバージョン固定
├── .swiftlint.yml          # SwiftLint 設定
├── Storylane/              # アプリ本体（このディレクトリ配下が app ターゲットの sources）
│   ├── App/                #   @main App, ルート View
│   ├── Features/           #   画面ごと（<Feature>View + <Feature>ViewModel）
│   ├── Repositories/       #   Supabase アクセス層
│   ├── Models/             #   Story / Project ...
│   └── Core/               #   SupabaseClient.swift, 共通ユーティリティ
└── Tests/                  # Swift Testing（XCTest は使わない）
```

新しいファイルは上記ディレクトリに置けば、`xcodegen generate` でプロジェクトに自動で取り込まれます
（個別に Xcode へ追加する必要はありません）。

## 依存パッケージ
- **supabase-swift**（`project.yml` の `packages` で管理、`from: 2.48.0`）

## シークレットの受け渡し（Config.xcconfig）
Supabase の URL / キーはコードに直書きせず `Config.xcconfig`（`.gitignore` 済み）で渡します。
**iOS でも anon ではなく Publishable key（`sb_publishable_...`）を使用**します。
具体的な配線は **Task 3（認証）** で実施（`Config.xcconfig.example` を用意し、`project.yml` の
`configFiles` で参照予定）。

## ビルド / テスト（CLI）
```bash
mint run xcodegen generate
xcodebuild build \
  -project Storylane.xcodeproj -scheme Storylane \
  -destination "platform=iOS Simulator,name=iPhone 16,OS=latest" CODE_SIGNING_ALLOWED=NO
xcodebuild test \
  -project Storylane.xcodeproj -scheme Storylane \
  -destination "platform=iOS Simulator,name=iPhone 16,OS=latest" CODE_SIGNING_ALLOWED=NO
```
