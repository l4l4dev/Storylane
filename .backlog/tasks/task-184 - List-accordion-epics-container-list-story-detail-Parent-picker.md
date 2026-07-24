---
id: TASK-184
title: List accordion + /epics container list + story-detail Parent picker
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-24 04:08'
updated_date: '2026-07-24 04:22'
labels: []
milestone: m-6
dependencies:
  - TASK-180
documentation:
  - doc-18
type: feature
ordinal: 2200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The remaining container-viewing surfaces (doc-18 §9): List-view 1-level accordion, /epics repurposed as the container list, and the story-detail Parent picker replacing the old Epic dropdown.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 List view: top-level rows are parent_id IS NULL; a container renders as a collapsible parent (epic_color + roll-up progress) expanding to children ordered by position; a child never also appears top-level
- [ ] #2 /projects/[id]/epics lists every is_container story with its roll-up progress bar, linking to story detail (route + Epics nav label kept)
- [ ] #3 story detail: former Epic dropdown becomes a Parent picker (lists containers; sets parent_id; single-level trigger rejects illegal choice), overflow menu Promote item replaced by Split entry
- [ ] #4 ends with a fable-advisor design review against spec/ux-principles.md before manual verification
- [ ] #5 Parent picker confirms before nesting under a not-yet-container target (that target becomes an epic and loses points/state/iteration, doc-18 §4/§9); no confirmation when the target is already a container
<!-- AC:END -->
