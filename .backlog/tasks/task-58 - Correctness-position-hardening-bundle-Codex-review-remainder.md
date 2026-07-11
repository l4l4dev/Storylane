---
id: TASK-58
title: Correctness & position hardening bundle (Codex review remainder)
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 16:12'
labels:
  - bug
  - concurrency
  - db
dependencies: []
priority: medium
ordinal: 15900
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
