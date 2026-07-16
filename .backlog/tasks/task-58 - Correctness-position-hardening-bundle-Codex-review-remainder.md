---
id: TASK-58
title: Correctness & position hardening bundle (Codex review remainder)
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 16:12'
updated_date: '2026-07-16 04:20'
labels:
  - bug
  - concurrency
  - db
milestone: m-2
dependencies: []
priority: medium
ordinal: 200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex full-codebase review (2026-07-12), remaining Medium/Low findings bundled:
1. Zero-row silent success: task toggle/delete + story delete (apps/web/app/stories/[id]/actions.ts:348-384) and epic update/delete (apps/web/app/projects/[id]/epics/actions.ts:45-75) check only the error, not affected rows — add .select('id') + exactly-one-row assertion (the TASK-22/26/31 pattern, applied to the remaining call sites).
2. max(position)+1 races: addTask, epic creation, lane creation, recurring-story position assignment — allocate positions under a lock/sequence or make insertion collision-tolerant; at minimum document and normalize on read.
3. Position invariants: many tables store integer positions with no uniqueness/scope constraints while the UI assumes dense stable order — document the invariant in spec/data-model.md and add feasible DB constraints (align with whatever TASK-56 RPCs decide).
4. Free-project creation is non-atomic (dashboard/actions.ts:111-145): project row commits before custom_statuses/invitations — move creation into one transactional RPC with an explicit invalid-invitee policy.
5. Edge Function client typing: git-webhook takes an untyped any client — type it with a narrow interface or generated types (may already be covered by TASK-53's work in that file; skip if so).
Sequencing: pick up AFTER TASK-56/57 so position rules land once, not twice.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No remaining mutation reports success on zero affected rows (repo-wide check)
- [ ] #2 Position allocation is race-safe or collision-tolerant everywhere it is derived from max+1
- [ ] #3 Position ordering invariant documented and DB-enforced where feasible
- [ ] #4 Project creation is all-or-nothing including default statuses
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Full Codex report: backlog doc-1 (.backlog/docs/reviews/) — read the matching finding before implementing.

CODE REVIEW UPDATE (2026-07-16): (a) Item 5 (git-webhook untyped client) is DONE — TASK-53 introduced the narrow WebhookClient interface (supabase/functions/git-webhook/index.ts:23); skip it. (b) ADD to this bundle: create index on activity_logs(story_id) — both the SET NULL FK and the new composite FK (20260715000006) are unindexed on the referencing side, so every story DELETE (incl. promote_story_to_epic) scans activity_logs. (c) ADD: extract shared SQL guard helpers when touching the RPC family — require_project_role(project_id, variadic roles) (two guard dialects now coexist: coalesce-vs-empty-string in skip_iteration/membership RPCs, 'v_role is null or not in' in move_story_board; one missed coalesce in a future RPC is a privilege hole), current_iteration(project_id) (copy-pasted in finish_story_from_git + move_story_board + finalize_iteration), _assert_not_last_owner (duplicated inside membership_admin_rpcs). (d) Item 3 (position invariants doc) should also record the single source of truth for zone predicates: the Backlog zone rule (iteration_id is null AND state<>'unscheduled') is currently defined independently in move_story_board.sql, board/actions.ts fetchBacklogOrder, and lib/utils/kanban.ts zoneForStory — document in spec/data-model.md which one is canonical and that the others must mirror it.
<!-- SECTION:NOTES:END -->
