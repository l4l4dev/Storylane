---
id: TASK-194
title: 'Spec revision for doc-20: screens.md, features.md, data-model.md'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-24 18:16'
updated_date: '2026-07-26 09:13'
labels:
  - docs
milestone: m-6
dependencies:
  - TASK-192
  - TASK-193
documentation:
  - doc-20
type: task
ordinal: 1780
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-20 §7. The spec still describes the shipped-but-superseded shape: containers living in the Icebox accordion, expanding only their Icebox children, and is_container as a purely child-derived flag. Once TASK-189..193 land, bring the spec back to the truth so the next session does not re-derive it from commits.

Run last, after the behaviour it documents is merged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 spec/screens.md 'Container accordion' section is rewritten to the Epics band (all children, location dots, no drag handle on mirror rows) and the two-line story rows
- [x] #2 spec/features.md Move/Copy container note matches the new attach rule
- [x] #3 spec/data-model.md documents epic_pinned and the derived is_container = has_children OR epic_pinned
- [x] #4 doc-18 §1/§4/§9 are marked as superseded by doc-20 where they are referenced
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TASK-192 (2026-07-25) requires one extra spec edit here, per the fable-advisor verdict on that task: doc-20 §7's asset table row for move_story_board's parent_id delta currently reads 'survives, but the caller stops sending state/iteration changes with it'. That turned out to be unimplementable — move_story_board's position machinery has no skip-position path and its no-anchor branch unconditionally writes position = max(position)+1, so any attach routed through it violates §5's 'position untouched'. Attach now goes through a dedicated set_story_parent RPC (migration 20260725131513) and move_story_board's parent delta has ZERO callers. Rewrite that §7 row to say so explicitly ('survives but is uncalled; set_story_parent is the only attach path'), or a future session will read the table and wire attach back through the delta.

Rewrote spec/screens.md's Container accordion section into Epics band + Two-line story rows (doc-20 §3/§4), including the mirror-row/no-drag-handle rule and attach=parent-only. Updated the Story detail editing Parent-picker paragraph and the overflow menu bullet to add Turn into epic... (TASK-196). Rewrote spec/features.md's Move/Copy container note: an epic_pinned container no longer auto-reverts to a normal story when its last child is removed (doc-20 §2), and updated the Epics & Labels summary to mention create_epic/set_epic_pinned/Epics band/two-pane /epics. spec/data-model.md: added the epic_pinned column, updated is_container's comment to has_children OR epic_pinned, and reworded the Container stories & roll-up prose (CHECK now also covers a pinned-but-childless epic; set_story_parent is parent-only unlike Parent-picker/split_story containerization). Marked doc-18 §1/§9 (surfacing) and the is_container lifecycle citations of §4 as superseded by doc-20 §2/§3/§5/§6 wherever those specific facts changed; left §4's unchanged trigger-clearing/logging citations and §5/§6/§8's untouched roll-up/RPC-guard citations as-is since doc-20 didn't touch them. Verified against actual shipped code (RPC names create_epic/set_epic_pinned/set_story_parent, not doc-20's originally-proposed unpin_epic; board-list-view.tsx EpicsBand/EpicBandRow; story-list-row.tsx two-line layout; epics/page.tsx two-pane) rather than doc-20's aspirational text alone.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Rewrote spec/screens.md, spec/features.md, spec/data-model.md against doc-20 (Epics band, epic_pinned, attach=parent-only, /epics two-pane), verified against the actually-shipped TASK-189..196 code (RPC names, component structure) rather than doc-20's text alone. Marked doc-18 §1/§4(lifecycle)/§9 citations as superseded by doc-20 where the underlying fact changed; left citations for mechanics doc-20 didn't touch. Docs-only change; verification is a careful reread of the diff against source, not a test suite.
<!-- SECTION:FINAL_SUMMARY:END -->
