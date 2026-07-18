---
id: TASK-88
title: 'story_pins: per-user today pin replaces stories.focus'
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-18 03:04'
labels:
  - web
  - db
dependencies:
  - TASK-83
priority: high
ordinal: 59000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-8 §9 data layer. New table story_pins(user_id, story_id) PK; RLS: SELECT/DELETE user_id = auth.uid(); INSERT WITH CHECK user_id = auth.uid() AND membership in the storys project; no cross-user reads. Drop stories.focus (no data migration, pre-launch) and its CHECK constraint remnants. Lifecycle integration: move_story_to_project recreates pins on the new story id for pinners who are members of the destination project and discards the rest (inside the existing SECURITY DEFINER RPC, spec/features.md Move/Copy); remove_member deletes the removed users pins in that project so they cannot revive on re-invite.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 story_pins exists with the specified RLS; RLS tests prove no cross-user visibility and member-only INSERT
- [ ] #2 stories.focus is dropped; no code references remain
- [ ] #3 Move carries pins per the rule; remove_member deletes pins; both covered by integration tests
- [ ] #4 rls-security-reviewer pass on the migration
- [ ] #5 pnpm test passes
<!-- AC:END -->
