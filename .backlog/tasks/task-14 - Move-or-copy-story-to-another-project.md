---
id: TASK-14
title: Move or copy story to another project
status: To Do
assignee: []
created_date: '2026-07-07 14:27'
updated_date: '2026-07-08 12:38'
labels:
  - web
  - db
dependencies:
  - TASK-15
references:
  - spec/features.md
  - spec/rls.md
priority: medium
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per spec/features.md 'Move / Copy to another project' and spec/rls.md: side peek overflow menu offers Move / Copy with a target picker (projects the user is a member of, either mode). Move carries title/description/type/tasks/labels(+recreate by name)/comments, lands as unscheduled in Icebox (tracker) or leftmost column (free), new per-project number, points kept only if in target scale, assignee kept only if member; original deleted; activity logged on both sides. Copy duplicates content only. Each operation is one SECURITY DEFINER RPC checking membership of both projects.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Move and Copy appear in the side peek overflow menu with a target-project picker limited to the user's projects
- [ ] #2 Move follows the spec carry-over rules (labels recreated, comments carried, epic/iteration dropped, points cleared when not in target scale, assignee cleared when not a member) and deletes the original
- [ ] #3 Copy duplicates title/description/type/tasks/labels only — no comments/history
- [ ] #4 Both are atomic SECURITY DEFINER RPCs verifying the caller is a member of source and target; rls-security-reviewer has reviewed the migration
- [ ] #5 Activity log entries created in both projects on Move (and target on Copy)
- [ ] #6 Tests cover tracker→free, free→tracker, point-scale mismatch, and non-member assignee cases
- [ ] #7 RPCs re-check inside: caller is owner/member in BOTH projects (viewer rejected), source != target, neither project archived; SECURITY DEFINER with fixed search_path, granted to authenticated only
- [ ] #8 Move = insert-into-target + re-parent tasks/comments/labels + delete-source in one transaction — never UPDATE project_id (numbering trigger pins number on UPDATE); focus/completed_at cleared on landing; lands at bottom of Icebox / leftmost column
- [ ] #9 Activity rows (story.moved_out / story.moved_in / story.copied_in) are inserted by the RPC itself; tests cover viewer-caller rejection, archived-project rejection, and a concurrent edit during Move failing as story-deleted
<!-- AC:END -->
