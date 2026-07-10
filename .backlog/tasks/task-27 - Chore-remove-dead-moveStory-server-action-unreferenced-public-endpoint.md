---
id: TASK-27
title: 'Chore: remove dead moveStory server action (unreferenced public endpoint)'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-10 10:37'
updated_date: '2026-07-10 23:46'
labels:
  - web
dependencies: []
priority: low
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Code review 2026-07-10: board/actions.ts exports moveStory but nothing in app/, components/, lib/, or tests references it — the drag flows all go through dropStory / dropStoryInList / dropStoryFree. Because it is a "use server" export it remains a callable endpoint, and it predates two later fixes: it only validates the destination iteration (a story could be pulled OUT of a done iteration) and it can leave a started story with iteration_id null (the TASK-19 stray state). Deleting it removes the exposure; no behavior change expected.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 moveStory and its imports are removed from board/actions.ts
- [x] #2 grep confirms no remaining references to moveStory in apps/web
- [x] #3 pnpm test and pnpm build pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
moveStory と付随する doc comment を board/actions.ts から削除。BACKLOG_CONTAINER_ID / ICEBOX_CONTAINER_ID の import も未使用化のため削除。grep で apps/web 全体を確認し参照なし。pnpm test (330 passed) と pnpm build 成功。
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-10 23:39
---
Reorder 2026-07-11: moved ahead of TASK-26 — both edit board/actions.ts, and deleting dead moveStory first gives TASK-26 a clean file.
---
<!-- COMMENTS:END -->
