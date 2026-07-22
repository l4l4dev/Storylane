---
id: TASK-129
title: >-
  Personal-task story detail: back-link goes to My Work, not the hidden
  project's Board
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 12:34'
updated_date: '2026-07-22 07:48'
labels: []
dependencies: []
priority: medium
type: enhancement
ordinal: 12600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-14 navigation fix (agreed early in the conversation, independent of the rest of doc-14's rework — can be done first). apps/web/app/stories/[id]/page.tsx:24 hardcodes href={`/projects/${detail.projectId}/board`} for the '← Board' link regardless of project type. For a personal-project (My Tasks) story, this is the only reachable path to that hidden project's full Board/Epics/Iterations/Activity/Settings nav, with no way back to it from the sidebar afterwards — confusing since that page was never meant to be a destination.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The story detail's back-link reads the story's project is_personal flag; when true, it links to /my-work instead of /projects/[id]/board
- [x] #2 A non-personal-project story's back-link is unchanged (/projects/[id]/board)
- [x] #3 The link label changes accordingly ('← My Work' vs '← Board')
- [x] #4 A test covers both cases
- [x] #5 pnpm test + lint green
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-22 07:39
---
Reassigned from @claude-haiku-4-5 to @claude-sonnet-5 per owner instruction (2026-07-22).
---

created: 2026-07-22 07:48
---
fable-advisor reviewed and approved as-is (agent af45dcbc9d9d86bdc): the "← My Work" label/href matches the sidebar's established My Work nav labeling, and the back-link text-arrow pattern matches settings/page.tsx's existing '← Projects' convention. Follow-up finding (out of scope for this task): story-peek-menu.tsx's PromoteToEpicDialog.handlePromote has the same hardcoded board-redirect bug for personal-project stories (router.push always targets /projects/:id/board after promoting, even for a personal project) — worth a separate task if the owner wants it fixed; also raises an open spec question of whether "Promote to Epic" should even be offered for personal-project stories at all, which needs owner input, not something advisor could resolve alone.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The story detail page's back-link now reads the story's project is_personal flag (threaded through StoryDetail.isPersonalProject from getStoryDetail's existing projects query) and links to /my-work with a '← My Work' label when true, leaving the non-personal /projects/:id/board case unchanged. Added app/stories/[id]/page.test.tsx covering both cases; updated existing StoryDetail test fixtures with the new field. fable-advisor approved with no required changes. Manually verified both cases in-browser.
<!-- SECTION:FINAL_SUMMARY:END -->
