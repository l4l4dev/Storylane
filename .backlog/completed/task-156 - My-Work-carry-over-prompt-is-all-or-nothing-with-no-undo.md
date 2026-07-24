---
id: TASK-156
title: 'My Work: carry-over prompt is all-or-nothing with no undo'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 13:39'
updated_date: '2026-07-22 22:21'
labels: []
milestone: m-5
dependencies: []
references:
  - >-
    .backlog/docs/reviews/doc-17 -
    17-—-UX-panel-review-2026-07-22-—-My-Work-screen-10-expert-ux-review.md
priority: medium
type: bug
ordinal: 780
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From doc-17 Medium finding #11. The carry-over prompt is one yes/no choice covering every carried-over item -- a misclick on 'Not today' drops the whole day's plan at once, with no way to undo. Add either per-item selection or a brief undo affordance after the choice resolves.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The carry-over decision is no longer strictly all-or-nothing (per-item selection) OR a short undo window is offered after resolving
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
AC#1: the carry-over banner now has a 3-phase state machine (prompting -> resolved -> hidden) instead of a permanent one-shot choice. Resolving either way shows a brief confirmation + an Undo button for 6s (auto-hides if not clicked); Undo toggles to the OTHER resolution on the same frozen ids (itself undoable, re-arming the window each click) rather than trying to restore the original stale state, which the two actions don't actually model. fable-advisor (opus fallback) design review hit its session limit mid-review and terminated early, but not before it caught a real bug: carryOverToday/dismissCarryOver both revalidatePath('/my-work'), which can refresh the assigned server prop while still inside the undo window -- staleToday (derived from that prop) would then read empty, silently collapsing the whole Undo banner (and losing which ids to act on) before the timer even fired. Fixed: carryPhase now freezes {carry, ids} at the moment of resolution and the banner's render/gate logic uses that frozen state instead of re-deriving from staleToday once resolved; added a regression test that rerenders with a since-revalidated prop (item no longer stale) and confirms the Undo banner survives with its frozen count intact. The remaining open design questions from the review prompt (6s window length, reusing the same collapse container for both phases, exact confirmation wording) were not covered before the agent cut off -- resolved by matching this file's own established patterns (ux-principles principle 3 already drove the shared collapse container to avoid a control-jumping misclick risk; the confirmation copy mirrors the original prompt's own count-only wording) rather than re-running the review. Tests: +3 (two undo-and-reverse cases, one revalidation-survival regression); full suite 681 pass; tsc/eslint clean. No DB/migration changes.
<!-- SECTION:FINAL_SUMMARY:END -->
