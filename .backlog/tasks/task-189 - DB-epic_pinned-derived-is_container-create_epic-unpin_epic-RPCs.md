---
id: TASK-189
title: 'DB: epic_pinned + derived is_container + create_epic/unpin_epic RPCs'
status: To Do
assignee:
  - '@claude-opus-5'
created_date: '2026-07-24 18:15'
labels:
  - db
milestone: m-6
dependencies: []
documentation:
  - doc-20
priority: high
type: feature
ordinal: 1730
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-20 §2. Today a container exists only while it has children (derive_is_container trigger), so an epic cannot be created top-down and cannot survive losing its last child — the root cause of two owner-reported defects (no + Add Epic, no way to file a known-big item as an epic first).

Add `epic_pinned boolean not null default false` and change the derived flag to `is_container = has_children OR epic_pinned`. The derive trigger must NOT be relaxed to let clients write is_container: that is exactly the hole TASK-182's rls-security-reviewer pass closed (a member sending is_container=false, points=5 to un-containerize a row).

epic_pinned is written only through two new SECURITY DEFINER RPCs (owner+member via require_project_role, explicit grant, decision-1): create_epic (creates a childless epic, and is also the 'make this existing story an epic' path) and unpin_epic (clears the flag; rejects while children remain).

This phase also freezes the attach contract TASK-192 depends on: setting parent_id never changes state_id, iteration_id or position.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 epic_pinned column added; is_container stays trigger-derived as (has_children OR epic_pinned); no client-writable path to is_container remains
- [ ] #2 create_epic creates a childless container and can containerize an existing story, clearing points/state_id/iteration_id and logging the old points to activity_logs (doc-18 §4 flip path)
- [ ] #3 unpin_epic clears epic_pinned and rejects while the story still has children
- [ ] #4 The off-board CHECK still holds for a pinned childless epic (points/state_id/iteration_id NULL)
- [ ] #5 Attach contract documented and tested: writing parent_id alone leaves state_id/iteration_id/position untouched
- [ ] #6 rls-security-reviewer pass plus /code-review high before merge (this migration touches TASK-182 remediation)
<!-- AC:END -->
