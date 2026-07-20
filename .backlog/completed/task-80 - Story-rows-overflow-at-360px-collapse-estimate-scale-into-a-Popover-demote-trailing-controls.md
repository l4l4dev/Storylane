---
id: TASK-80
title: >-
  Story rows overflow at 360px: collapse estimate scale into a Popover, demote
  trailing controls
status: Done
assignee:
  - '@codex-gpt-5'
created_date: '2026-07-18 01:57'
updated_date: '2026-07-19 06:28'
labels:
  - web
  - ux
milestone: m-0
dependencies:
  - TASK-79
priority: low
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two merged findings. (a) UX panel Medium #26 (doc-7, Wroblewski): an unestimated feature renders the entire point scale inline via TransitionButtons, overflowing the row on phones — put the estimate buttons behind a single 'Estimate' trigger using the existing Popover (board-filters precedent). (b) Codex adversarial review 2026-07-18 of feat/ux-panel-high-fixes: even after TASK-79's responsive demotion, state/assignee/actions remain shrink-0 while the title holds min-w-[7rem], so worst-case rows exceed the ~312px content area at 360px with no horizontal overflow handling (story-list-row.tsx:59-115). Fix both together; verify with a 360px layout regression test asserting scrollWidth <= clientWidth for a long-title unestimated feature row.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Unestimated feature at 360px shows a single Estimate trigger; point buttons open in a Popover
- [x] #2 pnpm test passes
- [x] #3 Worst-case story row (long title, all chips, transition controls) encodes the 360px overflow contract in class-based assertions (w-full/min-w-0/max-w-full row, flexible truncating title, collapsed point scale); real-browser 360px verification rides TASK-94
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-18 05:57
---
Reassigned to @codex-gpt-5 (2026-07-18): precisely-scoped layout fix + regression test; story-list-row.tsx survives the concept redesign, so this does not conflict with TASK-84/91.
---

author: @claude-fable-5
created: 2026-07-18 15:13
---
Codex adversarial review 2026-07-19 on the uncommitted diff: the 360px overflow test asserts `row.scrollWidth <= row.clientWidth` (story-list-row.test.tsx:94), but jsdom performs no layout so both are always 0 — the assertion passes even if the CSS is broken. Replace it with class-based assertions that encode the overflow contract (as the neighboring breakpoint test does), or a real-browser check; do not ship the vacuous assertion. Adding Playwright just for this is likely overkill — the real 360px check can ride the deferred production visual pass (TASK-94).
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Estimate point scale collapsed behind a single Popover trigger in TransitionButtons (pressable, pending feedback on the trigger — ux-principles 1/2/3 pass, fable design review 2026-07-19); story rows carry w-full/min-w-0/max-w-full with a flexible truncating title so worst-case 360px rows cannot overflow. AC evidence: story-list-row + transition-buttons tests 16/16 (incl. collapsed-scale and overflow-contract assertions after replacing the jsdom-vacuous scrollWidth check flagged by Codex review), full suite incl. real-DB 494/494, lint clean. Implemented by @codex-gpt-5, review fixes by @claude-fable-5. Committed in bf20a77 together with TASK-90 (shared story-list-row hunks); real-browser 360px pass rides TASK-94.
<!-- SECTION:FINAL_SUMMARY:END -->
