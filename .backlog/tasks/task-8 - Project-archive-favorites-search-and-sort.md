---
id: TASK-8
title: 'Project archive, favorites, search and sort'
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-07 14:25'
updated_date: '2026-07-10 10:34'
labels:
  - web
  - db
dependencies:
  - TASK-7
references:
  - spec/screens.md
  - spec/data-model.md
priority: medium
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Projects page management features per spec/screens.md 'Projects page' and spec/data-model.md: owner-only archive (projects.archived_at, hidden behind an Archived filter, read-only while archived), per-user favorites (project_members.is_favorite, pinned first), name search, and sort (last updated default / name / created).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Migration adds projects.archived_at and project_members.is_favorite; rls-security-reviewer has reviewed it
- [ ] #2 Owner can archive/unarchive from the card overflow menu with confirmation; archived projects appear only under the Archived filter and are read-only for non-owners
- [ ] #3 Pin toggle on cards; favorited projects sort first on /dashboard and in the sidebar switcher
- [ ] #4 Search box filters by name; sort select offers last updated / name / created
- [ ] #5 Tests cover archive gating, favorite ordering, and search/sort
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow-up from TASK-14 (Move/Copy story): move_story_to_project /
copy_story_to_project (supabase/migrations/20260711000001_move_copy_story.sql)
were implemented WITHOUT the "neither project archived" re-check from
spec/features.md's Move/Copy hardening note, since projects.archived_at
doesn't exist yet (deferred per user decision 2026-07-11). Once this task
adds that column, add the check to both RPCs and cover it with a test
(archived-project rejection), matching AC#7/#9 of TASK-14.
<!-- SECTION:NOTES:END -->
