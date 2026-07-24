---
id: TASK-183
title: Split Studio screen (Web)
status: In Progress
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-24 04:08'
updated_date: '2026-07-24 12:47'
labels: []
milestone: m-6
dependencies:
  - TASK-181
  - TASK-184
documentation:
  - doc-18
type: feature
ordinal: 2300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Full-feature Split Studio focus screen at /stories/[id]/split (doc-18 §7, no MVP trim). Web-first. Entry: story detail overflow menu "Split" (labelled 分割する/Split, never "convert to epic").
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Two panes: left = source story title/description/tasks read-only; right = dynamic list of new child cards (title/description/story_type/tentative points)
- [x] #2 Text-selection cut-out: selecting description text and "extract as a new story" appends a right card seeded with the selection
- [x] #3 Drag-and-drop reassignment of existing source tasks onto right cards; points total compares right cards sum vs source old points; pre-commit preview
- [x] #4 Commit calls split_story; on success returns to board/List with the new container expanded (no teleport, ux-principles §8/§10)
- [x] #5 ends with a fable-advisor design review against spec/ux-principles.md before manual verification
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From TASK-181 /code-review (split_story RPC gaps the Split Studio UI must cover):
- epic_color: split_story inherits the source's epic_color, which is NULL for a normal story -> a split-born epic is colorless. The Studio should let the user pick the epic's color and pass it through (split_story may need an epic_color param, or set it here). doc-18 §2/§7.
- Studio must prevent assigning one task to two children (drag = one target); the RPC silently keeps a duplicated task_id on the first child only.
- Studio must validate child title/points/task_ids before commit; split_story surfaces raw Postgres errors for a missing title / malformed uuid. (Points are now also scale-validated server-side by the TASK-181 follow-up.)

epic_color detail (TASK-182 /code-review): the dropped epics table defaulted color to '#6366f1'. split_story inherits the source's epic_color, which is NULL for a normal story, so a split-born epic is colorless — a regression vs the old promote path. The Studio should pick/default the epic color (default #6366f1 if no picker).

Implemented (branch feat/epic-story-unification). Advisor-reviewed BEFORE implementation on 3 design points (child-card fields: dedicated 4-field component, not StoryFields; task DnD: scoped dnd-kit DndContext, not native HTML5; post-commit nav: one-shot ?view=list&icebox=1 query params, not just icebox — a container only shows in List view's Icebox, so a Kanban-viewing user needed List forced too).

Built: /stories/[id]/split (page.tsx + split-studio.tsx) — two panes, source read-only left / dynamic child cards right (split-child-card.tsx, dedicated title/description/story_type/points fields). Text-selection cut-out (window.getSelection on the description, 'Extract selection as new story' seeds a card). Task drag-and-drop (split-source-task-row.tsx draggable, split-child-card.tsx droppable, SOURCE_TASKS_DROP_ID for un-assign) — pure routing (applyTaskDrop/assignTaskToChild/unassignTask, lib/utils/split-studio.ts) unit tested; DnD mechanism itself verified in a real browser (jsdom can't lay out real pointer-distance drags). Points comparison, pre-commit preview, split_story action re-added (removed prematurely in TASK-181, correctly re-added here since this task owns the route). Split menu entry in story-peek-menu.tsx, hidden for container/child/personal (decision A).

Post-implementation fable-advisor design review (Opus fallback — Fable hit session limit) found 3 hold-merge issues + 2 should-fix, all fixed:
- (A, real bug) kanban-board.tsx's one-shot ?view=list override had no way to release — clicking Kanban after a split redirect updated writeBoardView but the view computation stayed forced to List (dead Kanban button) for the rest of the mount. Fixed: forcedView is now real state, cleared by both toggle buttons' onClick.
- (B, owner decision: default color) split_story/Parent-picker containerization left epic_color NULL (a normal story has none) — regression vs the old promote flow's #6366f1 default. Fixed on recompute_is_container's false->true flip itself (migration 20260724121514) rather than in split_story specifically, since the Parent picker (TASK-184) triggers the same flip via a plain parent_id UPDATE — coalesce(epic_color, '#6366f1'), never overwrites an existing color.
- (C) commit was reachable with a blank child title, surfacing a raw Postgres error. Fixed: Split disabled while any child's trimmed title is empty, with an inline hint (not just a silent disable).
- (D, should-fix) left task list didn't distinguish assigned from unassigned tasks. Fixed: split-source-task-row.tsx dims an assigned task and shows '→ {child title}'.
- (E, polish) 'of 0 pts' misread as a real 0-point budget for an unestimated source -> 'of — pts'; added hint text for the disabled Extract button and the task list's drag affordance.

Verified: unit 768 pass, lint + tsc clean, integration 30/30 (incl. new epic_color-default tests in nesting.integration.test.ts). Full manual browser walkthrough TWICE — once before the advisor fixes (drag-and-drop, text-selection, points, commit, roll-up all confirmed working end-to-end) and once after (View-toggle-no-longer-dead confirmed by switching to Kanban post-redirect; epic_color confirmed #6366f1 via direct DB query, not just a UI fallback).

/code-review high (owner-run, 10 findings) — 9 fixed, 1 rejected (owner decision):
1. (fixed) split-child-card.tsx: switching to a story_type that doesn't use points (chore/release) now clears points, matching storyTypeUsesPoints elsewhere in the app.
2. (fixed) split_story RPC accepted the same task_id under two children, silently dropping the second child's reassignment (first child's UPDATE already moved the task's story_id away). Migration 20260724123806 rejects it upfront with a clear error; new integration test covers it (14/14 pass).
3. (fixed) handleCommit's double-submit guard read `pending` (React state, batched) from a stale closure — a fast double-click could fire split_story twice. Replaced with a synchronous committingRef.
4. (documented) forcedView/showIcebox are seeded once via useState initializer, so the one-shot ?view=list&icebox=1 override only takes effect on a fresh mount — true here because the only caller (split-studio's post-commit redirect) always navigates in from a different route. Expanded the inline comment; no code change needed.
5. (rejected — owner decision) SplitChildCard duplicates StoryFields' title/description/story_type/points fields. Kept as a dedicated component: this was an explicit advisor-approved design decision earlier in the same task (a split child has no assignee/labels, so extending StoryFields would mean growing it with hide-props unused by every other caller). Owner confirmed keeping the dedicated component over extending StoryFields.
6. (fixed) The one-shot query-param-strip pattern was duplicated between kanban-board.tsx and settings-save-toast.tsx. Extracted `withoutSearchParams` (lib/utils/url.ts, unit tested) and both now call it; settings-save-toast.tsx now also preserves unrelated query params it previously wiped.
7. (fixed) assignTaskToChild reimplemented unassignTask's removal logic. Now calls unassignTask first, then assigns.
8. (fixed) 3 reviewer-attributed ("fable-advisor: ...") comments removed per CLAUDE.md's comment policy (kanban-board.tsx, split-source-task-row.tsx, split-studio.tsx) — kept the underlying WHY, dropped the attribution framing.
9. (fixed) split-studio.tsx's component docstring restated spec/screens.md's content; trimmed to a bare doc/spec pointer.
10. (fixed) List/Kanban toggle buttons' onClick handlers duplicated `setForcedView(null); writeBoardView(...)`. Extracted a `selectView(next)` helper.

Re-verified after all fixes: unit 772 pass (4 new: url.test.ts x2, split-child-card.test.tsx points-clear x2), lint clean, tsc clean, split.integration.test.ts 14/14 (incl. new duplicate-task_id test), database.types.ts regenerated (no diff — split_story's signature unchanged).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Split Studio (/stories/[id]/split): two-pane split UI, text-selection cut-out, task drag-and-drop reassignment, points comparison, pre-commit preview, commits via split_story with a no-teleport redirect (one-shot List+Icebox open). Advisor-reviewed both before (3 design points) and after (5 findings, all fixed: a dead-control view-toggle bug, epic_color defaulting, blank-title validation, assigned-task visibility, wording polish) implementation. Verified via 768 unit + 30 integration + two full manual browser walkthroughs.
<!-- SECTION:FINAL_SUMMARY:END -->
