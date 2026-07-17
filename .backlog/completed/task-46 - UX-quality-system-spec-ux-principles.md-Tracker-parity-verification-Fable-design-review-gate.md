---
id: TASK-46
title: >-
  UX quality system: spec/ux-principles.md + Tracker-parity verification + Fable
  design review gate
status: Done
assignee:
  - '@claude-fable-5'
created_date: '2026-07-11 06:07'
updated_date: '2026-07-11 17:26'
labels:
  - ux
  - docs
  - process
milestone: m-0
dependencies: []
priority: high
ordinal: 42000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Decided by the owner 2026-07-11: the usability problems found in the 2026-07-11 review happened because spec defines rules (what is allowed) but not interaction design (how it looks/responds), while original Pivotal Tracker had that design worked out. Institutionalize three countermeasures:

1. Write spec/ux-principles.md — short, enforceable principles distilled from the review, e.g.: no dead controls (a visible button must be pressable or explain itself in place — never disabled + hover-only reason); every action gives visible feedback (silent no-ops forbidden); no layout shift from conditional UI (toggles/affordances reserve their space); destination of a create action is always visible at the point of action; saved values render as text, not as live input fields; destructive/irreversible buttons never sit in the primary click path; dates always YYYY/M/D.
2. Tracker-parity verification: for any tracker-mode screen/interaction, check the original Pivotal Tracker behavior first via Wayback Machine archives of pivotaltracker.com/help (the live site is gone; fetch with 'https://web.archive.org/web/2024id_/<original help URL>' — verified working with curl). Record the finding in the task before implementing. Add this as a rule in ux-principles.md and reference it from CLAUDE.md.
3. Design review gate: every UI-affecting task gets a fable-advisor design review after implementation, against ux-principles.md, before the owner's manual verification. Add the rule to CLAUDE.md workflow section.

Existing open UI tasks (TASK-32, 34-38, 41-45) must reference ux-principles.md once it lands — add a note to each.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 spec/ux-principles.md exists with concrete, checkable principles (each traceable to a real defect from the 2026-07-11 review)
- [x] #2 CLAUDE.md references the principles file and mandates Tracker-parity check + fable design review for UI tasks
- [x] #3 Open UI tasks are annotated to follow the principles
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Survey spec/ directory layout and SPEC.md index to place ux-principles.md correctly
2. Write spec/ux-principles.md: design language (4px radius, dense/utilitarian), ~10 checkable interaction principles each traceable to a 2026-07-11 review defect, Tracker-parity verification procedure (Wayback), Fable design-review gate definition
3. Add ux-principles.md to the SPEC.md index
4. Update CLAUDE.md: reference principles file; mandate Tracker-parity check + fable design review for UI tasks
5. Annotate open UI tasks (TASK-32, 34-38, 41-45) with a pointer to the principles
6. Check ACs, finalize
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DESIGN LANGUAGE DECIDED (owner, 2026-07-11): square, Material-M2-like look, not today's heavy rounding. Implemented: globals.css --radius changed 0.625rem → 0.25rem (4px; all radius-* tokens derive from it, rounded-full avatars/dots intentionally stay circular). ux-principles.md must record this as the design language baseline: sharp 4px corners, dense utilitarian layout in the spirit of original Pivotal Tracker / Material 1-2 — new components must use the radius tokens, never hardcoded larger radii.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wrote spec/ux-principles.md: design language baseline (4px radius via tokens, dense layout, YYYY/M/D dates, no third-party product names in copy) + 10 checkable interaction principles, each traceable to a 2026-07-11 review defect; Tracker-parity verification procedure via Wayback (curl pattern verified working); fable-advisor design review gate. Added the file to the SPEC.md index, added the mandate to CLAUDE.md Critical Rules, and annotated all open UI tasks (TASK-32..45 where UI-relevant) with pointers to the relevant principles. Docs-only change — no automated tests apply.
<!-- SECTION:FINAL_SUMMARY:END -->
