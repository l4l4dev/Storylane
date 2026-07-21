---
id: TASK-133
title: >-
  Project Settings: Doing/Done -> My Work mapping configuration + broken-mapping
  banner
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 12:35'
labels: []
dependencies:
  - TASK-130
priority: medium
type: feature
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-14 (My Work Kanban rework). Adds a Project Settings section letting the owner map this project's own project_states to My Work's Doing/Done virtual columns (or leave either/both unmapped -- an explicit, always-available choice, not just an empty default). Also implements the 'mapping broken' alert: if the mapped state was deleted (FK on delete set null) or changed category since being configured, a banner surfaces on the My Work page (not project-side) telling the affected user to reconfigure. See .backlog/docs/doc-14's project_my_work_mapping section.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Project Settings has a 'My Work sync' section (owner-only, matching this project's existing owner-gated settings sections) with two selectors: Doing -> one of this project's project_states (or 'Not mapped'), Done -> same
- [ ] #2 Saving writes to project_my_work_mapping via a server action gated by owner role (RLS already enforces this; the action surfaces a clear error if a non-owner somehow calls it)
- [ ] #3 If a mapped state's category no longer matches (in_progress for doing_state_id, done for done_state_id -- e.g. the owner recategorized it since mapping), the read-side treats it as unmapped, matching doc-14's classification logic, not a client-side check
- [ ] #4 My Work surfaces a banner when a story's project has a mapping that's now invalid (doing_state_id/done_state_id null after a delete, or a category mismatch) -- 'This project's Doing/Done sync is no longer valid, reconfigure in Settings', linking to that project's Settings page
- [ ] #5 fable-advisor design review against spec/ux-principles.md passes
- [ ] #6 spec/screens.md 'Project Settings' section updated
- [ ] #7 pnpm test + lint green
<!-- AC:END -->
