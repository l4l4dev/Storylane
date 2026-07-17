---
id: TASK-32
title: >-
  Projects page UX fixes: post-create redirect, full title display, archived
  grouping
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-11 05:16'
updated_date: '2026-07-12 09:07'
labels:
  - web
  - ux
milestone: m-0
dependencies: []
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three UX problems on the Projects page (user review 2026-07-11).

1. Creating a project returns to /dashboard (apps/web/app/dashboard/actions.ts:152 'redirect(/dashboard)') instead of opening the new project. Redirect to the new project's board.
2. Project titles are truncated on cards (apps/web/components/features/projects/project-card.tsx) and hard to read. Widen the card/title area so the full name is visible in the list (wrapping to multiple lines is acceptable).
3. When 'show archived' is on, archived projects appear first. Active boards and archived ones must be clearly distinguishable: group archived projects in a separate section at the BOTTOM of the list (e.g. 'Archived' heading), never mixed with active ones.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 After creating a project the browser lands on the new project's board page
- [x] #2 Full project name is readable on the projects list (no ellipsis truncation for typical-length names)
- [x] #3 Archived projects render in a separate section below all active projects when visible
- [x] #4 Tests cover redirect target and archived-section grouping
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow spec/ux-principles.md (landed with TASK-46): design language (4px radius tokens, YYYY/M/D dates), no dead controls, no silent no-ops, no layout shift, archived-below-active. End with a fable-advisor design review against that file before manual verification.

Implemented: (1) createProject redirects to /projects/${project.id}/board (was /dashboard); invite_failed banner now shared (InviteFailedBanner component) and rendered on both dashboard/page.tsx and board/page.tsx (both tracker BoardPage and free-mode FreeBoardPage) since the redirect target changed. (2) project-card.tsx: CardTitle truncate -> break-words, name wraps instead of ellipsis-truncating. (3) project-list.ts: filterAndSortProjects now sorts isArchived after all active projects (outranks favorite/sort) so a just-archived project's bumped updatedAt can't put it at the top; project-grid.tsx splits the already-sorted list into activeProjects/archivedProjects and renders archived under an 'Archived' <h2> heading, always after active. Tests: project-list.test.ts (+4), project-grid.test.tsx (+1, checks DOM order via compareDocumentPosition), project-card.test.tsx (+1), dashboard/actions.test.ts (3 redirect assertions updated). Verified in browser: create -> lands on new board; long title wraps; archiving a project moves it to the Archived section at the bottom even though its updated_at is now the most recent. Full pnpm vitest (371 passed), tsc --noEmit, eslint clean.

fable-advisor review: 承認(修正なし、ブロッキング指摘なし)。post-create redirect / invite_failed banner の3箇所表示 / break-words / archived-last sort、いずれも spec/ux-principles.md 原則8-10に適合。非ブロッキングで2点: (1) project-card.tsx:107 の toLocaleDateString() は既存の日付表示違反だが、これは全アプリ横断のTASK-39のスコープなのでここでは触れない。(2) InviteFailedBanner の「Project settings」をboardページではリンク化する改善提案 — 小さく低リスクなので反映済み: settingsHref? propを追加し、board/page.tsx の両方(tracker/free)から /projects/{id}/settings を渡す。dashboardページはproject id文脈がないのでplain textのまま。テスト追加(invite-failed-banner.test.tsx、6件)。Full pnpm vitest (377 passed), tsc, eslint clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Three Projects-page UX fixes: (1) createProject now redirects to the new project's board instead of /dashboard, preserving invite_failed on the new target; the invite-failure banner became a shared InviteFailedBanner component (with an optional settingsHref link, per advisor suggestion) rendered on dashboard/page.tsx and both branches of board/page.tsx. (2) project-card.tsx's title no longer ellipsis-truncates (break-words instead) — long names wrap. (3) project-list.ts's filterAndSortProjects sorts archived after every active project (overriding favorite-first), and project-grid.tsx renders the two groups as separate sections with an 'Archived' heading, so a just-archived project can no longer jump to the top of a recency sort. fable-advisor review: approved, no blocking corrections; the one applied suggestion (settings link) is in. Verified in the browser (create → lands on new board; long title wraps; archiving moves a project to the bottom Archived section even with the most recent updated_at). Full pnpm vitest (377 passed), tsc --noEmit, eslint clean.
<!-- SECTION:FINAL_SUMMARY:END -->
