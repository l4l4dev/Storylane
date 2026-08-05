---
id: TASK-230
title: Upgrade Next.js 16.2.11 to 16.3
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-08-04 11:09'
updated_date: '2026-08-05 07:23'
labels: []
milestone: m-2
dependencies: []
priority: medium
ordinal: 1200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Next.js 16.3 (released 2026-08-03) ships zero-config wins that all land on upgrade: up to 90% less dev-server memory (Turbopack disk cache + memory eviction on by default), cached `next build` artifacts, ~22% more SSR throughput (native Node streams), fewer prefetch requests, and versioned docs for AI agents (`next dev` auto-maintains an AGENTS.md block pointing at bundled docs).

Our `next.config.ts` only sets `transpilePackages`, so nothing conflicts.

Out of scope (revisit separately): Instant Navigations opt-in flags (`cacheComponents`/`partialPrefetching` — changes the caching model), TypeScript 7 type checking, experimental Rust React Compiler.

Release notes: https://nextjs.org/blog/next-16-3
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 apps/web depends on next 16.3.x and eslint-config-next 16.3.x
- [x] #2 Full suite passes from apps/web: `pnpm test` and `pnpm run lint`
- [x] #3 `pnpm build` completes without new warnings/errors
- [x] #4 The AGENTS.md block auto-written by `next dev` is reviewed; kept content does not conflict with existing agent instructions
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. apps/web で next と eslint-config-next を 16.3 系に上げる (pnpm add)
2. next.config.ts は transpilePackages のみで衝突なし、変更不要
3. pnpm test / pnpm run lint を apps/web から実行して確認
4. pnpm build で warning/error なしを確認
5. next dev を起動し AGENTS.md に自動追記されるブロックを確認、既存指示との衝突有無をチェック
6. AC を確認しコミット
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
next@16.3.0 / eslint-config-next@16.3.0 に更新。pnpm test (927 passed), pnpm run lint (exit 0, 既存コードに新ルール @next/next/no-location-assign-relative-destination の warning 1件 — app/auth/login/page.tsx:49, オーナー判断で今回は残す), pnpm build 成功、新規warning/errorなし。next dev 起動を確認し、apps/web/CLAUDE.md (AGENTS.md の実体) 末尾に <!-- BEGIN:nextjs-agent-rules --> ブロックが自動追記されることを確認、既存指示と非衝突のためオーナー判断で保持しコミット。

実装完了、AC1-4 検証済み。/code-review 待ち(commit提案前に必須)。
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-sonnet-5
created: 2026-08-05 07:21
---
auth/login/page.tsx:49 の @next/next/no-location-assign-relative-destination warning: window.location.href → router.push() への変更はタスクスコープ外の挙動変更のため、オーナー確認の上、今回は警告を残したまま完了する方針で確定(2026-08-05)。
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
next@16.3.0 / eslint-config-next@16.3.0 に更新。pnpm test 927 passed、pnpm build 成功で新規warning/errorなし、pnpm run lint は既存コードに新ルール1件の warning(exit 0、スコープ外としてオーナー確認済み・残置)。next dev の AGENTS.md 自動生成ブロックを確認し apps/web/CLAUDE.md に保持。/code-review 実施、findings 0件。
<!-- SECTION:FINAL_SUMMARY:END -->
