---
id: TASK-190
title: 'List: Epics band — expand every child, drop containers from the Icebox'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-24 18:15'
labels:
  - web
milestone: m-6
dependencies:
  - TASK-189
documentation:
  - doc-20
type: feature
ordinal: 1740
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-20 §3. Containers currently render inside the Icebox column and expand only their Icebox children, so an epic looks like frozen work and its contents vanish as they get scheduled (owner defects 2 and 3).

Move them into a dedicated collapsible Epics section at the top of the List view, ordered independently, and expand every child regardless of zone. Tracker parity: epics live in their own panel and never appear in the Backlog/Icebox panels (doc-20 §1).

The band's child rows are a deliberately lighter mirror of the real zone rows — the real row stays in Current/Backlog/Icebox and remains the thing you drag and act on.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A collapsible Epics section renders at the top of the List view; collapse state persists in localStorage like the existing groups
- [ ] #2 An epic row shows its epic_color chip, #number + title, the roll-up progress bar (doc-18 §5) and its point total
- [ ] #3 Expanding lists every child regardless of zone, ordered by position, as a light row: location dot (Current/Backlog/Icebox/Done) + #number + title + points, with the precise location (e.g. Backlog #3) on hover
- [ ] #4 Container rows no longer render in the Icebox column; the Icebox shows only plain unscheduled stories
- [ ] #5 Band child rows are not drag sources and render no drag handle (ux-principles §1 — no control that looks grabbable but refuses)
- [ ] #6 + Add Epic calls create_epic (TASK-189) and lands with the new epic expanded (ux-principles §10); an empty epic shows a no-stories-yet state
- [ ] #7 fable-advisor design review against spec/ux-principles.md before manual verification
<!-- AC:END -->
