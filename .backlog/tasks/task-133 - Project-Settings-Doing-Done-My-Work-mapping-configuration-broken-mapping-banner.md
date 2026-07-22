---
id: TASK-133
title: >-
  Project Settings: Doing/Done -> My Work mapping configuration + broken-mapping
  banner
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 12:35'
updated_date: '2026-07-22 05:52'
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
- [x] #1 Project Settings has a 'My Work sync' section (owner-only, matching this project's existing owner-gated settings sections) with two selectors: Doing -> one of this project's project_states (or 'Not mapped'), Done -> same
- [x] #2 Saving writes to project_my_work_mapping via a server action gated by owner role (RLS already enforces this; the action surfaces a clear error if a non-owner somehow calls it)
- [x] #3 If a mapped state's category no longer matches (in_progress for doing_state_id, done for done_state_id -- e.g. the owner recategorized it since mapping), the read-side treats it as unmapped, matching doc-14's classification logic, not a client-side check
- [x] #4 fable-advisor design review against spec/ux-principles.md passes
- [x] #5 spec/screens.md 'Project Settings' section updated
- [x] #6 pnpm test + lint green
- [x] #7 My Work surfaces a banner only when a mapped state still exists but its category no longer matches (in_progress for doing_state_id, done for done_state_id) -- 'This project's Doing/Done sync is no longer valid, reconfigure in Settings', linking to that project's Settings page. A DELETED mapped state falls back to 'Not mapped' silently (FK on delete set null -- indistinguishable at the current schema from a never-configured column; doc-14 round-5 addendum)
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-sonnet-5
created: 2026-07-22 05:05
---
Implemented on branch feat/task-131-my-work-backend (not committed to this task's message yet, see next comment for commit hash). Files: components/features/projects/my-work-mapping-settings.tsx (Doing/Done selectors, drifted-state warning), app/projects/[id]/settings/actions.ts's saveMyWorkMapping, app/projects/[id]/settings/page.tsx wiring (owner-only), components/features/my-work/my-work-mapping-broken-banner.tsx + its wiring in app/my-work/page.tsx, lib/utils/my-work.ts's brokenMappingProjectIds (pure, tested), spec/screens.md's new "Project Settings" section.

Scope decision (owner-approved): only category-drift is detected/banered; a mapped state later DELETED (vs never configured) is indistinguishable at the current schema and intentionally out of scope (no schema change added).

fable-advisor review (AC #5): first pass found 2 required fixes, both resolved and re-reviewed as approved:
1. The broken-mapping banner was showing to ALL project members regardless of role, while the Settings section to fix it is owner-only -- a member would see "reconfigure in Settings" pointing at a section they can't see. Fixed: brokenMappingProjectIds now takes an ownerProjectIds set; my-work/page.tsx fetches the viewer's own project_members.role and only owner-role projects can appear in the banner. New test: "is hidden from a viewer who isn't this project's owner, even if genuinely broken".
2. The drift warning text ("save to update, or pick another") implied re-saving the same drifted selection would fix it; it doesn't (same id, same drift). Reworded to make clear a different selection is required.

Verification: hands-on in browser -- mapped My Tasks project's Doing/Done to its own states via Settings, confirmed the row persists in project_my_work_mapping. tsc + lint green; full suite 595 passed.

Not yet verified: an actual end-to-end drag with a mapped project syncing to the real board (browser automation for drag-and-drop proved unreliable throughout this session, both for this feature and the pre-existing project board -- see TASK-132's notes). The underlying set_story_state call path is unit-tested (actions.test.ts) and unchanged from TASK-132. Owner to confirm with a manual drag test.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added owner-only 'My Work sync' section to Project Settings (Doing/Done selectors writing project_my_work_mapping) + a My Work banner for category-drifted mappings, scoped to project owners only. Verified: mapped My Tasks project's Doing/Done via Settings UI, confirmed persisted in project_my_work_mapping; tsc/lint green; full suite 595 passed; fable-advisor design review passed after 2 rounds of fixes (owner-scoping bug, misleading drift-warning copy). Merged to main in ef69153/d8f6fe4.
<!-- SECTION:FINAL_SUMMARY:END -->
