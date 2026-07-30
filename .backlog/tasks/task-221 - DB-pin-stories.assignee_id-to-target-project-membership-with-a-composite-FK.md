---
id: TASK-221
title: 'DB: pin stories.assignee_id to target-project membership with a composite FK'
status: To Do
assignee:
  - '@claude-opus-5'
created_date: '2026-07-30 02:54'
updated_date: '2026-07-30 03:43'
labels: []
milestone: m-2
dependencies: []
priority: medium
ordinal: 1250
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Split out of TASK-219 on fable-advisor's verdict: the composite FK is the right long-term answer for 'the assignee must be a member of the story's project', but it exceeds TASK-219's ACs because it changes behaviour for every writer, not just the two cross-project RPCs.

Today assignee_id is written without any membership check. That is documented as deliberate (20260722000002_my_work_data_model.sql: 'any member can set assignee_id to an arbitrary profile ... the relaxed stories write model, 20260719000002'), and maintain_story_completed_at re-checks membership defensively to stop a forged completion for a non-member. Separately, remove_member does not unassign the removed user's stories — it only clears my_work_story_state — so a removed member stays assigned indefinitely.

Proposed mechanism: a composite FK stories(project_id, assignee_id) -> project_members(project_id, user_id) with ON DELETE SET NULL on assignee_id. project_members' PK is already (project_id, user_id), the shape matches the existing composite FKs on stories.state_id / iteration_id and activity_logs_story_project_fk, and PG17 supports column-specific ON DELETE SET NULL. The engine then takes the KEY SHARE lock itself at write time, so no explicit re-check is needed in any RPC, and remove_member's DELETE unassigns as a side effect.

Costs to design before implementing: a cleanup migration for existing dangling assignees (rows would otherwise fail the ALTER); the resulting hard failure on update_story / split_story / create_draft_story when a client sends a non-member assignee, which needs an error-display decision for the autosave path (spec/screens.md 'Conflict & failure rules'); and whether maintain_story_completed_at's defensive check becomes redundant. Note the FK's automatic KEY SHARE lock is the documented exception to spec/rls.md's three-tier lock order (recorded there by TASK-219).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Existing stories whose assignee_id is not a member of their project are cleaned up by a migration before the constraint is added
- [ ] #2 The composite FK is in place and a non-member assignee is rejected for every write path (update_story, split_story, create_draft_story, move/copy)
- [ ] #3 Removing a member unassigns their stories in that project, with a test
- [ ] #4 The autosave path surfaces the rejection per spec/screens.md 'Conflict & failure rules' instead of failing silently
- [ ] #5 Any now-redundant in-RPC membership check (including maintain_story_completed_at's) is either removed or its remaining purpose documented
- [ ] #6 The two out-of-tier pins TASK-219 documents in spec/rls.md are revisited: this FK gives remove_member's DELETE a story row lock (via ON DELETE SET NULL), which is exactly the counterparty that would turn them into a cycle — and it also makes move/copy's explicit for share on the membership row redundant
<!-- AC:END -->
