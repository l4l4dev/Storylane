---
id: TASK-146
title: 'TASK-59 follow-up: missing test for Icebox count-badge layout-shift fix'
status: Done
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-22 11:14'
updated_date: '2026-07-23 03:31'
labels: []
milestone: m-2
dependencies: []
priority: low
type: chore
ordinal: 870
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Re-verification of TASK-59 (2026-07-22, in .backlog/completed/ -- not linkable as a CLI dependency due to a separate known CLI bug where completed/ tasks are invisible to backlog CLI) found its AC #3 ('Tests cover both, following kanban-board-toolbar.test.tsx's pattern') only half-satisfied. The Icebox toggle button's own view-visibility is tested, but the count badge's 0/1 boundary (the specific layout-shift regression AC #2 fixed) has no dedicated test. AC #1 (FinishIterationButton) and #2 (badge fix itself) are implemented correctly -- this is a test-coverage gap only. Another session is currently doing test-related work -- do not start until that lands, then first check whether it already added this coverage before writing a new test.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A test exercises the Icebox count badge crossing the 0/1 boundary and asserts the view switcher's position does not shift, following kanban-board-toolbar.test.tsx's existing pattern
- [x] #2 If re-verification after the other session's work shows this coverage already exists, this task is closed noting where
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Checked for the other session's test-related work first, per this task's own instruction -- git log showed no dedicated Icebox-badge test commit landed, and no existing test in the repo covers the count badge's 0/1 boundary specifically (kanban-board-toolbar.test.tsx only tested the Icebox button's own mount-across-views behavior). Added the missing test: renders KanbanBoard with an empty icebox (badge mounted, textContent '0', invisible + aria-hidden) then rerenders with one icebox story (badge still mounted, textContent '1', visible, no aria-hidden) -- proving the badge is never removed/re-added across the boundary, following the existing 'keeps the Icebox button mounted' test's assertion style in the same file. Tests: +1; full suite 691 pass; tsc/eslint clean.
<!-- SECTION:FINAL_SUMMARY:END -->
