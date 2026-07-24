---
id: TASK-184
title: List accordion + /epics container list + story-detail Parent picker
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-24 04:08'
updated_date: '2026-07-24 08:09'
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
- [ ] #6 Parent picker writes parent_id through local+synced state (not just the DB) so a field autosave never resends a stale detail.parentId, and realtime reconciliation includes parentId — a server-side reparent (Parent picker, split_story, or a concurrent session) must not be reverted by a subsequent autosave (found in TASK-180 /code-review; story-detail-panel.tsx:157 + realtime mergeRemote LOCKABLE_FIELDS)
- [ ] #7 Story-detail overflow menu is container-aware: a container hides/disables Move to project / Copy to project (the split_story/move/copy RPCs reject containers server-side, doc-18 §8) and Split; StoryDetail must surface is_container for this (found in TASK-181 /code-review)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner decision 2026-07-24 (from TASK-181 /code-review #5): the Split entry (AC#3) is HIDDEN for personal-project stories — option A. Splitting a personal task would containerize it (drops from My Work) with unassigned children (also absent from My Work), so it appears to vanish. So the overflow Split item shows only for non-personal, non-child, non-container stories. (Personal projects keep no Split affordance, mirroring the old Promote-hidden behavior — but for a UX reason now, not the promote data-loss reason.)

From TASK-181 /code-review (#5): the story-detail Delete confirmation should be container-aware. Deleting a container ungroups its children (parent_id ON DELETE SET NULL -> children become top-level; no data loss), but the dialog only warns about comments. Add an 'its N child stories will be ungrouped' notice when detail.is_container. Pairs with the container-aware Move/Copy hide already noted for this task.
<!-- SECTION:NOTES:END -->
