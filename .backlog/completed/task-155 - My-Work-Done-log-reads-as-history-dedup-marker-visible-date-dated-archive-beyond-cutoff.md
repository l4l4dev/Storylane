---
id: TASK-155
title: >-
  My Work: Done log reads as history (dedup marker, visible date, dated archive
  beyond cutoff)
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 13:39'
updated_date: '2026-07-22 17:04'
labels: []
milestone: m-5
dependencies: []
references:
  - >-
    .backlog/docs/reviews/doc-17 -
    17-—-UX-panel-review-2026-07-22-—-My-Work-screen-10-expert-ux-review.md
priority: medium
type: feature
ordinal: 760
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From doc-17 Medium findings #12 and #14, expanded per owner direction 2026-07-22. #12: a story that is both live and completed currently renders in an active column and in Done, distinguished only by a subtle marker -- reads as a duplication bug. Owner decision: strengthen the marker toward Norman/Krug's direction (make it read as history), not Ive's removal direction. #14: Done is dressed as a peer draggable column (same shell, grip, count) but is actually an append-only, time-boxed log -- differentiate its chrome so that nature is visible. Owner additionally asked for: the completion date to be visibly shown on each Done entry (currently only in a hover title per doc-17 #41, not visible at rest); the log's cutoff window to be a configurable setting instead of the current hardcoded 7 days; and a dated archive list where entries older than the cutoff can still be viewed (rather than just disappearing from Done). Keep the archive view read-only and simple -- if it needs a new DB column/table beyond what story_completions already provides, keep the migration minimal (existing RLS already covers story_completions).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A completed story that still shows elsewhere reads distinctly as history (not a duplicate/bug), per the owner-chosen strengthen direction
- [x] #2 Done's chrome (no grip, distinct shell) visibly signals it is an append-only log, not a peer draggable column
- [x] #3 Each Done entry shows its completion date visibly in the row (not only in a hover tooltip)
- [x] #4 The archive cutoff (currently fixed at 7 days) is configurable via settings
- [x] #5 A dated archive list lets the user see entries older than the cutoff
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
AC#1/#3: strengthened completion marker (visible checkmark + 'Completed' text, full date in title) replaces the old icon-only/hover-only marker -- distinguishes a Done log entry from the same story's live card elsewhere (doc-15 additive log). Per owner decision this session, the per-row date itself is NOT shown inline (fable-advisor found it redundant with the pre-existing date-group header above each entry, e.g. 'Today'/'Yesterday'/date, and it crowded out the title in Done's w-72 column) -- date is visible via that group header + the row's hover title, which the owner confirmed satisfies the original intent. AC#2: Done lost its drag grip and move buttons (new MyWorkColumnShell 'reorderable' prop, false only for Done) AND was excluded from the reorderable displayOrder/resolveColumnOrder entirely (defaultOrder no longer includes 'done'; a stale 'done' in an old stored order is dropped like any invalid id) -- Done now renders as a fixed flex sibling outside the column SortableContext, always last. This was upgraded from a lighter first pass (just hiding Done's own grip) once testing showed an ADJACENT column's move-right button could still reposition Done as a side effect -- full exclusion was needed to actually satisfy 'not a peer draggable column'. AC#4: new profiles.my_work_done_window_days (int, 1-90, default 7, migration 20260723000001, rls-security-reviewer approved, matches the my_work_column_order/my_work_column_names grant precedent exactly) + a settings form at /settings under a new 'My Work' section (mirrors TimeOffSettings' pattern) + Done's new subheader shows 'Last N days' + an Archive link. AC#5: new read-only /my-work/archive route -- completions older than the configured window, grouped by date via the existing groupDoneByDate, same MyWorkRow component with no drag wrapper. fable-advisor (opus fallback) design review: approved with the one required fix (above, marker weight) applied; confirmed Done's subheader doesn't break column-height parity (lg+ columns share a fixed height class regardless of subheader), confirmed the archive's date-boundary math exactly tiles with the main page's Done query (gte/lt on the same cutoff timestamp, no gap or double-count), and flagged (non-blocking, noted as a ponytail: comment in archive/page.tsx) that the archive query has no row limit yet -- fine while archives are small, add pagination when they grow. Tests: +18 across my-work-row/my-work-sections/my-work.test.ts/my-work-done-window-settings (new file); full suite 678 pass, 124 My Work integration tests pass (SUPABASE_INTEGRATION=1), grant-lockdown test still passes; tsc/eslint clean. (Two unrelated pre-existing integration tests -- membership.integration.test.ts, working-day-calendar.integration.test.ts -- intermittently fail with 'test user already registered' under concurrent local test runs; confirmed unrelated to this task's scope and pass in isolation.)
<!-- SECTION:FINAL_SUMMARY:END -->
