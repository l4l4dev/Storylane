---
id: TASK-147
title: >-
  Personal project: seal every seam (hide tracker features, block leak paths) +
  dev-only My Tasks debug view
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 11:22'
updated_date: '2026-07-22 12:33'
labels: []
dependencies: []
priority: high
type: enhancement
ordinal: 300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner decision 2026-07-22 (follow-up to doc-15): keep the hidden is_personal project as the storage model and invest in making it FULLY invisible instead. Trigger: 'Promote to Epic' on a personal task converts the story into an epics row in the hidden 'My Tasks' project (promote_story_to_epic DELETES the story - the task vanishes from My Work, my_work_story_state cascades away, and story_completions rows cascade too = permanent Done-log data loss), then navigation lands on the hidden project's iteration board. Audit and close ALL such seams; also add a dev-only debug window into the hidden project so the owner can inspect the real data. Not in scope: grouping features for personal tasks (if wanted later, that is a My Work concept, not epics).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Promote to Epic is hidden for personal-project stories in every surface that offers it, AND promote_story_to_epic itself rejects is_personal projects (new migration, full-function replacement; comment must name the story_completions cascade data-loss as the reason the guard is server-side)
- [x] #2 Personal story detail hides tracker-only affordances: estimate/points, iteration display, epic selector. Checklist, comments, description, labels, and Move to project (team promotion) stay
- [x] #3 Direct URL access to the personal project's pages (board/epics/iterations/activity/settings) redirects to /my-work - except via the debug entry below in development
- [x] #4 Membership: verify the personal project cannot gain members (invite path); if any RPC-level path is open, close it with an is_personal guard
- [x] #5 MCP: verify the personal project is not addressable via MCP tools and record the result in the task (doc-15 declared it out of scope - confirm reality matches)
- [x] #6 Dev-only debug access: available ONLY in development builds, visually labeled as debug (e.g. a 'Debug: My Tasks' entry on My Work), giving the owner a way to inspect the hidden project's underlying data (stories + state, my_work_story_state, story_completions). No trace of it in production
- [x] #7 fable-advisor design review against spec/ux-principles.md passes
- [x] #8 rls-security-reviewer pass on the migration; pnpm test + lint green (from apps/web/)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
AUDIT FINDINGS (all verified against current code):
1. promote_story_to_epic gates only on project_role='owner' - personal project creator is always sole owner, so nothing blocks it. DELETEs the story, cascading my_work_story_state + story_completions (permanent Done-log loss). StoryPeekMenu always offers it; StoryDetail already has isPersonalProject (TASK-129) but unused there.
2. StoryFields (shared by StoryDetailPanel + DraftStoryCard/MyWorkQuickAdd) always shows Points+Epic. TransitionButtons' own client-side needsEstimate gate is independent of set_story_state's server-side is_personal exemption (TASK-139), so personal tasks (always feature-type, unpointed) see a needless Estimate popover blocking one-click Start. No 'iteration display' exists anywhere in story detail (grepped clean) - nothing to hide there.
3. /projects/[id]/board|iterations|epics|activity|settings all have zero is_personal check; direct URL fully renders. All share ONE layout choke point (app/projects/[id]/layout.tsx) - single fix point.
4. Membership can grow via TWO paths: invite_member RPC has no is_personal check, AND project_members has a raw client-writable RLS INSERT policy ('owners can add members') that bypasses invite_member entirely. Grepped every project_members insert call site: 100% admin/service-role test fixtures, zero legitimate app paths - same shape as TASK-110/115's iterations/project_states lockdowns.
5. MCP (apps/mcp/src/client.ts): bot always signs in as a SEPARATE dedicated account (AGENT_EMAIL/PASSWORD), never the owner's session, RLS-gated like any user. Confirmed doc-15's 'MCP out of scope' claim holds, contingent on fix #4.
6. EXTRA FINDING (not in original ACs but in scope per seal-every-seam intent): getMoveTargetProjects lists the hidden personal project BY NAME as a Move/Copy target - existence leak + lets team data land inside My Work's domain.

PLAN (pending fable-advisor pre-implementation review, dispatched):
- One migration: promote_story_to_epic + invite_member get is_personal rejections (full-function replacement, comment on promote_story_to_epic must name the story_completions cascade); revoke project_members direct INSERT grant (RPC-only, mirrors TASK-110/115).
- layout.tsx: fetch is_personal+created_by, redirect own personal project to /my-work (one choke point for all 5 pages).
- story-peek-menu.tsx: hide Promote to Epic when isPersonalProject.
- story-fields.tsx: new hidePointsAndEpic prop, threaded from StoryDetailPanel + DraftStoryCard/MyWorkQuickAdd.
- transition-buttons.tsx: new isPersonal prop, skips needsEstimate popover.
- getMoveTargetProjects: exclude is_personal from target list.
- New dev-only debug page (NODE_ENV!=production), separate route (not reusing the tracker board since layout redirect would fight it), linked from My Work as labeled 'Debug: My Tasks'.
- Tests throughout; rls-security-reviewer on the migration; fable-advisor post-implementation design pass (AC#7).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Full audit + implementation summary:

AUDIT (all verified against actual code before implementing):
- promote_story_to_epic gated only on project_role='owner' - personal project creator is always sole owner, so nothing blocked it. DELETEs the story, cascading my_work_story_state + story_completions (permanent Done-log loss).
- StoryFields (shared by StoryDetailPanel + DraftStoryCard/MyWorkQuickAdd) always showed Points+Epic. TransitionButtons' client-side needsEstimate gate was independent of set_story_state's server-side is_personal exemption (TASK-139) - personal tasks (always feature-type, unpointed) saw a needless Estimate popover. No 'iteration display' exists anywhere in story detail (grepped clean) - nothing to hide there (AC#2 partially N/A).
- All 5 /projects/[id]/* pages had zero is_personal check; found they share ONE layout choke point (app/projects/[id]/layout.tsx).
- Membership could grow via TWO paths: invite_member RPC (no is_personal check) AND project_members' raw client-writable RLS INSERT policy bypassing invite_member entirely - grepped every insert call site, zero legitimate app paths (same shape as TASK-110/115).
- MCP (apps/mcp/src/client.ts): bot signs in as a separate dedicated account, RLS-gated like any user, no special privilege - confirmed doc-15's 'MCP out of scope' claim holds given the membership fix.
- EXTRA FINDING dropped from scope per fable-advisor + doc-11 D1's existing 'intentional, don't re-flag' decision: getMoveTargetProjects still lists the personal project as a move/copy target - NOT changed, respecting the prior decision.

IMPLEMENTATION:
- Migration 20260722000014: promote_story_to_epic + invite_member get is_personal rejections (full-function replacement, diff-verified against prior versions - only the guard block added); project_members INSERT locked to RPC-only (drop policy + revoke grant, mirrors TASK-110/115).
- layout.tsx: redirects the viewer's own personal project to /my-work - one choke point for all 5 pages.
- story-peek-menu.tsx: Promote to Epic hidden when isPersonalProject.
- story-fields.tsx: new hidePointsAndEpic prop, wired from StoryDetailPanel + DraftStoryCard/MyWorkQuickAdd.
- transition-buttons.tsx: new isPersonal prop skips the needsEstimate popover; wired from story-detail-panel.tsx only (story-list-row.tsx doesn't need it - personal board is unreachable now, confirmed by fable-advisor).
- New dev-only debug page app/dev/my-tasks/page.tsx: notFound() in production (not just a hidden link), ordinary RLS-scoped client, shows stories+my_work_story_state+story_completions. Linked from my-work/page.tsx, dev-only.
- spec/screens.md + spec/features.md updated: invites now blocked (reversing that half of doc-11 D1), move/copy target unchanged (keeping that half).

VERIFICATION: every new integration test proven to genuinely fail without the fix (reverted old function bodies + old policy via psql, confirmed 3/5 tests fail, confirmed a fresh reset back to 5/5); layout.tsx redirect test proven the same way (temporarily disabled the guard, confirmed the test fails, restored). tsc + lint clean. Full suite 855/855 on a clean reset (one transient concurrency flake in the pre-existing, untouched membership.integration.test.ts during a heavy-parallel full-suite run, not reproduced on isolated or repeat runs - unrelated to this task).

rls-security-reviewer: clean. fable-advisor (both pre-implementation plan review AND post-implementation AC#7 review): approve. Non-blocking cleanup noted for later: PromoteToEpicDialog is now dead code in story-peek-menu.tsx for personal stories.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-sonnet-5
created: 2026-07-22 12:32
---
rls-security-reviewer: CLEAN, no findings. Verified (a) both function body diffs are exactly the is_personal guard block added, nothing else changed; (b) project_members lockdown is complete - traced every CREATE POLICY + direct INSERT across all migrations, zero other client INSERT path exists, ENABLE (not FORCE) RLS + zero INSERT policies = deny-by-default, matches TASK-115 precedent exactly; (c)/(d) confirmed via the integration test + my revert-and-reprove exercise; (e) no other privilege concern. LOW/informational only: grant-lockdown.integration.test.ts doesn't need touching since both functions kept their existing signatures (sanity-checked).
---

author: @claude-sonnet-5
created: 2026-07-22 12:32
---
fable-advisor (post-implementation, AC#7): approve, no blocking changes. Confirmed (1) layout.tsx's silent redirect is fine - not a principle-2 case (navigation via stale link, not a user-initiated action expecting visible feedback; no in-app link to a personal project's tracker pages exists anymore per grep); (2)/(3)/(4) omitting controls entirely (not disabling) correctly follows principle 1, hidePointsAndEpic is session-constant so no principle-3 layout-shift concern; (5) the dev debug page's labeling/formatting/no-truncation-of-IDs are all appropriate for a dev-only inspection tool; (6) audited TransitionButtons' full caller list, confirmed My Work itself never uses it (drag-only) so only story-detail-panel.tsx needed the isPersonal wire-through, matching my own audit. Non-blocking cleanup note: PromoteToEpicDialog in story-peek-menu.tsx is now unreachable dead code for a personal story (its trigger is gone) - harmless, flagged for a future /simplify pass, not required now.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Sealed every remaining seam of the hidden is_personal 'My Tasks' project: (1) promote_story_to_epic + invite_member now reject is_personal server-side (migration 20260722000014, both diff-verified as adding only the guard block); (2) project_members' direct-INSERT RLS bypass locked to RPC-only, matching the TASK-110/115 precedent; (3) app/projects/[id]/layout.tsx redirects the viewer's own personal project to /my-work for all 5 tracker pages in one choke point; (4) Promote-to-Epic UI hidden, Points/Epic fields hidden (StoryFields hidePointsAndEpic), and the client-side Estimate gate now matches the server's is_personal exemption (TransitionButtons isPersonal) - all omit rather than disable, per ux-principles principle 1; (5) MCP audited and confirmed already out of scope, contingent on the membership fix; (6) a new dev-only /dev/my-tasks page (404s in production, ordinary RLS-scoped client) gives the owner the only remaining window into the hidden project's raw data. doc-11 D1's Move/Copy-target decision was deliberately left untouched per fable-advisor + the owner's prior 'intentional, don't re-flag' note. Every guard proven to matter by reverting it and watching the corresponding test fail, then restoring. rls-security-reviewer: clean. fable-advisor: approve (both the pre-implementation plan and the post-implementation build). Full suite 855/855, tsc + lint clean.
<!-- SECTION:FINAL_SUMMARY:END -->
