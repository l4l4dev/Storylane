---
id: TASK-51
title: Move backlog insert+resequence onto a Postgres RPC
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 11:29'
updated_date: '2026-07-11 17:26'
labels:
  - web
  - refactor
  - backend
milestone: m-2
dependencies: []
priority: medium
ordinal: 15750
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
quickCreateStory's backlog-target branch and createBacklogDivider/dropStoryInList all do a non-transactional insert-then-persistBacklogOrder sequence (fable-advisor review on TASK-36). If persistBacklogOrder fails after the insert lands, the story/divider is already created but quick-add-composer.tsx's error message ('press Enter to retry') invites resubmission, risking a duplicate. Per the decision-1 pattern already used for update_story/transition_story, unify insert+resequence into one Postgres RPC shared by all three call sites.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 quickCreateStory (backlog target), createBacklogDivider, and dropStoryInList's insertion path all go through one shared RPC that inserts and resequences positions in a single transaction
- [ ] #2 A failure partway through cannot leave an orphaned story/divider with no corresponding position update
- [ ] #3 Existing tests for these three actions pass unchanged (or updated only for the new call shape)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Overlap note (2026-07-12): TASK-56 (Codex review: consolidate ALL board drag/drop mutations into transactional reorder RPCs) covers the same persistBacklogOrder surface from the other direction. Implement TASK-51's insert+resequence RPC as part of / in the same design pass as TASK-56's RPC family — one position-rules implementation, not two. TASK-58 item 2-3 (max+1 races, position invariants) also lands there.
<!-- SECTION:NOTES:END -->
