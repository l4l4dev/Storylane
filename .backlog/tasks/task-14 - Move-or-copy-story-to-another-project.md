---
id: TASK-14
title: Move or copy story to another project
status: Done
assignee:
  - '@l4l4dev'
created_date: '2026-07-07 14:27'
updated_date: '2026-07-10 03:13'
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
- [x] #1 Move and Copy appear in the side peek overflow menu with a target-project picker limited to the user's projects
- [x] #2 Move follows the spec carry-over rules (labels recreated, comments carried, epic/iteration dropped, points cleared when not in target scale, assignee cleared when not a member) and deletes the original
- [x] #3 Copy duplicates title/description/type/tasks/labels only — no comments/history
- [x] #4 Both are atomic SECURITY DEFINER RPCs verifying the caller is a member of source and target; rls-security-reviewer has reviewed the migration
- [x] #5 Activity log entries created in both projects on Move (and target on Copy)
- [x] #6 Tests cover tracker→free, free→tracker, point-scale mismatch, and non-member assignee cases
- [x] #7 RPCs re-check inside: caller is owner/member in BOTH projects (viewer rejected), source != target, neither project archived; SECURITY DEFINER with fixed search_path, granted to authenticated only
- [x] #8 Move = insert-into-target + re-parent tasks/comments/labels + delete-source in one transaction — never UPDATE project_id (numbering trigger pins number on UPDATE); focus/completed_at cleared on landing; lands at bottom of Icebox / leftmost column
- [x] #9 Activity rows (story.moved_out / story.moved_in / story.copied_in) are inserted by the RPC itself; tests cover viewer-caller rejection, archived-project rejection, and a concurrent edit during Move failing as story-deleted
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation:
- Migration 20260711000001_move_copy_story.sql: move_story_to_project /
  copy_story_to_project — first RPCs in the codebase touching two projects
  in one transaction. Advisor-reviewed twice (initial design, then a
  rls-security-reviewer finding fixed post-hoc: the initial version let any
  authenticated caller distinguish "story not found" from "not a member of
  source" by probing arbitrary story ids, since SECURITY DEFINER bypasses
  RLS entirely on the locked SELECT. Fixed by filtering that SELECT to only
  stories in a project the caller is owner/member of, collapsing both cases
  into one generic "Story not found").
- AC#7/#9 "neither project archived" / "archived-project rejection test":
  deferred by explicit user decision (2026-07-11) since projects.archived_at
  doesn't exist yet (TASK-8 not started). TODO comment left in the
  migration; a follow-up note was appended to TASK-8's notes so the check
  gets added there instead of being silently forgotten.
- UI: StoryPeekMenu extended with "Move to project…" / "Copy to project…"
  items sharing one MoveCopyDialog component (mode prop), with a
  getMoveTargetProjects action populating the target picker (owner/member
  projects only, excluding the current one).
- describeActivity() got labels for story.moved_out/moved_in/copied_in.
- Found and fixed a JSX whitespace bug during manual browser testing: text
  split across JSX lines with an embedded expression immediately followed
  by same-line literal text collapsed the space before "move"/"labels"
  ("...tasks and commentsmove to...") - not caught by any automated test
  since Testing Library's getByText doesn't visually render whitespace
  collapse the same way a real browser paints it. Fixed by building the
  dialog copy as a single JS template string instead of JSX children.

Verification:
- lib/utils/move-copy.integration.test.ts (SUPABASE_INTEGRATION=1, 11
  cases): tracker->free, free->tracker, point-scale mismatch (kept/cleared),
  assignee kept/cleared by target membership, label dedup on name collision,
  completed_at set when landing in an is_done free-mode column, viewer
  rejection (folded into generic "not found"), target-membership rejection,
  post-move task-insert failing (story-deleted path), concurrent
  bidirectional move between the same two projects, and Copy's
  tasks-copied/no-comments/source-untouched behavior. All 11 pass.
- story-peek-menu.test.tsx: Move/Copy dialog wording + empty-target-list
  state (component tests).
- rls-security-reviewer and web-conventions-reviewer both ran; the RLS
  finding above was fixed and re-verified; the conventions finding
  (kebab-case file naming) is a false positive matching every existing
  component file in the repo, not changed.
- Full pnpm test / lint / tsc pass. Manually verified end-to-end in the
  browser across two real projects (tracker -> free Move, and Copy),
  including activity log entries on both sides.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented Move/Copy story to another project (spec/features.md) as two SECURITY DEFINER RPCs (move_story_to_project, copy_story_to_project) — the first cross-project transactions in this codebase — plus Move/Copy items in the story peek's overflow menu with a target-project picker. Verified with an 11-case DB integration test, component tests, RLS/conventions reviews (one real security finding fixed: a story-existence probe via differentiated error messages), and manual end-to-end browser testing across two projects. The 'neither project archived' check is deferred to TASK-8 by user decision, tracked via a TODO comment and a note on TASK-8.
<!-- SECTION:FINAL_SUMMARY:END -->
