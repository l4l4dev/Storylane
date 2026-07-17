---
id: TASK-79
title: 'UX panel review High fixes (2026-07-18): board screen streamlining'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-17 15:16'
updated_date: '2026-07-17 15:25'
labels:
  - web
  - ux
dependencies: []
priority: medium
ordinal: 700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
10-expert UX panel review (/ux-review skill, 2026-07-18) of the tracker board screen produced 12 High-impact findings; owner approved fixing all High. Two are already tracked in TASK-77 (filter clear-all + filtered-empty-state hint; view persistence) — this task covers the other ten. All are visual/interaction streamlining, no palette/font changes, must work in light+dark and at mobile widths.
(1) Iteration bar prints the end date twice — drop the 'auto-finishes on {end}' span, fold into the range label (kanban-board.tsx:152-160). Flagged by 7 experts.
(2) List view repeats iteration identity: section header restates 'Iteration #N · current · pts' under the bar that already says it — reduce header to 'Current · {pts} pts' (board-list-view.tsx:1180-1185).
(3) Iteration-goal edit pencil is hover-only (invisible on touch) — make it persistently faint, e.g. opacity-60 (kanban-board.tsx:393-396). 5 experts for persistent, 1 for removal; owner approved persistent.
(4) StoryListRow: title is the only shrinkable element and gets crushed by shrink-0 chips — give the title a min width and responsively demote points/epic chips like labels already are (story-list-row.tsx:53-113).
(5) h-[calc(100dvh-13rem)] is duplicated in two files and mis-sizes columns when the header wraps on mobile — make fixed height lg-only and hoist the value to one shared constant (kanban-columns-board.tsx:140, board-list-view.tsx:955).
(6) Committed pts and velocity are far apart — move velocity from the page header into the iteration bar as '{committed} / {velocity} pts committed' (page.tsx:260, kanban-board.tsx:156).
(7) h1 is a bare 'Board' — show project.name (already fetched) as the heading, demote 'Board'; pass projectName to FreeBoardPage too (page.tsx:259,433).
(8) Label/epic chips render user-chosen color as text over a 13%-alpha tint of the same hue — contrast fails for pale/dark colors; keep color in the dot only, render names in text-foreground (story-card.tsx:79-88,154-161; story-list-row.tsx:84-92).
(9) Deleting a planning note / manual iteration break is instant with no confirm while Finish iteration confirms — reuse the existing confirm-dialog pattern (board-list-view.tsx:199-215,338-353; precedent TASK-72).
(10) MutationErrorBanner mounts at the top of the scroll region so a failed drop deep in a long backlog reports off-screen — make it sticky or scrollIntoView+focus on set (board-list-view.tsx:1175, kanban-columns-board.tsx:301).
Full panel report (incl. Medium/Low findings deferred) lives in the 2026-07-18 session; Medium/Low were not approved yet.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Iteration bar shows the end date exactly once
- [ ] #2 List view current-section header no longer repeats iteration number/dates shown in the bar above
- [ ] #3 Goal edit affordance is visible without hover (touch discoverable)
- [ ] #4 Story list row keeps a readable title width at 360px with all chips present
- [ ] #5 Board column height constant defined once; columns size correctly when the header wraps on mobile
- [ ] #6 Velocity and committed points are adjacent in the iteration bar; standalone header velocity span removed
- [ ] #7 Board h1 shows the project name in both tracker and free mode
- [ ] #8 Label/epic chip text uses theme foreground tokens; user color appears only as dot/tint (readable in light+dark regardless of chosen color)
- [ ] #9 Note and manual-break deletion ask for confirmation before executing
- [ ] #10 A rejected drag/drop mutation shows its error within the viewport regardless of scroll position
- [ ] #11 pnpm test passes and existing board tests updated for changed markup
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-17 15:22
---
Full panel report (all High/Medium/Low findings, consensus themes, conflicts) archived as doc-7 — read it when picking this up or when batching the deferred Medium/Low items.
---

created: 2026-07-17 15:25
---
Ordering note: TASK-79 (then TASK-77) must land before TASK-61/52/78 — those touch the same board files, and implementing them first would invalidate this review's file:line anchors. Dependencies set accordingly; ordinals 700/750.
---
<!-- COMMENTS:END -->
