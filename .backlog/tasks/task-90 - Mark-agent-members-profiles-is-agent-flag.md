---
id: TASK-90
title: 'Mark agent members: profiles is-agent flag'
status: Done
assignee:
  - '@gpt-5.6-sol'
created_date: '2026-07-18 03:05'
updated_date: '2026-07-18 15:46'
labels:
  - web
  - db
dependencies:
  - TASK-83
priority: medium
ordinal: 61000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-8 §8. Add an is-agent boolean to profiles (default false) so UIs can tell agent members from humans; set it on the existing bot profile (spec/mcp.md agent-as-member). Show a small agent indicator wherever members render (member list, assignee chips, activity). Capacity math (TASK-86) treats agents like humans via the same calendar; no exclude-AI toggle in v1; no per-user weekday patterns (deferred).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 profiles carries the flag; bot profile flagged; RLS unchanged and re-verified
- [x] #2 Member list and assignee UI show an agent indicator
- [x] #3 pnpm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add profiles.is_agent, backfill the existing claude_agent profile, add the small migration, and regenerate the database types. Leave the RLS policies unchanged.
2. Add a reusable AgentIndicator and propagate is_agent through the member list, Kanban/List assignee chips, assignee options, and activity displays. In TASK-80's story-list-row, preserve the existing layout diff and make only the minimal assignee-chip change.
3. Add component and real-database integration tests, then run the unit suite, integration suite, lint, type checking, and production build.
4. Do not deploy the migration remotely. Keep TASK-90 In Progress until the RLS security reviewer and fable-advisor reviews are available.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented profiles.is_agent migration, generated DB types, and reusable AgentIndicator. Propagated the flag through Settings member list, Board/Iteration assignee chips, board filters, story assignee picker, project Activity, and story History. Added component and RLS integration tests; updated MCP setup docs.

Adversarial backfill verification found the documented username claude-agent violated profiles_username_format ([a-z0-9_]); corrected spec/mcp.md, apps/mcp/README.md, and migration to claude_agent. A transaction-scoped pre-existing bot simulation verified claude_agent is backfilled to is_agent=true, then rolled back.

Validation: local migration up succeeded; profiles.is_agent is NOT NULL DEFAULT false; existing 3 profiles RLS policies remained unchanged; anonymous SELECT is 42501 and authenticated SELECT succeeds. Web unit suite 409 passed / 83 skipped; Web real-DB suite 492/492 passed; MCP real-DB suite 13/13 passed; targeted TASK-90 component tests 30/30 passed; tsc --noEmit, ESLint, Next production build, generated-type diff, and git diff --check passed. One unrelated CommentThread async test flaked once in the first full run, then passed alone and in the clean full rerun.

No remote migration/deploy. Browser skill was invoked for required UI verification, but this session exposed no browser backend; manual visual verification remains. Required fable-advisor UI review and deferred rls-security-reviewer pass remain unavailable, so task stays In Progress.

Review fixes applied 2026-07-19 (@claude-fable-5, owner-approved triage): [R1] migration now replaces the table-level UPDATE grant with an explicit column list — grant update (display_name, avatar_url, username) — because a column-level REVOKE cannot carve columns out of a table-level grant (the reviewer's suggested one-liner would have been a silent no-op). INSERT path checked: rows are created only by the handle_new_user trigger, client INSERT hits the PK, upsert's update half is blocked by the column grant, and profiles has no DELETE policy — no INSERT-side lockdown needed. [R2] integration test now covers: is_agent self-update rejected (42501), display_name still updatable through the new grant, plus the original read-scoping cases — 3/3 pass against a reset local DB. [D1] assignee chips render the original size-5 rounded-full circle for humans and switch to a rounded (4px) pill only when assigneeIsAgent. [D2] compact AgentIndicator got role=img. Full suite with SUPABASE_INTEGRATION=1: 494/494, lint clean. Remaining before Done: commit (blocked on story-list-row.tsx sharing uncommitted TASK-80 changes incl. its vacuous 360px assertion), remote migration via the new deploy pipeline, owner visual check deferred to TASK-94.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-18 06:29
---
Reassigned to @gpt-5.6-sol (2026-07-18, Claude quota exhausted): small migration + UI indicator. Same condition as TASK-84 — migration held from deploy until the deferred rls-security-reviewer pass.
---

author: @gpt-5.6-sol
created: 2026-07-18 15:29
---
Implementation and automated verification are complete. Holding TASK-90 In Progress for the required fable-advisor UI review, rls-security-reviewer migration review, and manual visual verification; migration has not been deployed remotely.
---

author: @claude-fable-5
created: 2026-07-18 15:37
---
Review results 2026-07-19 (required passes before merge/migration): rls-security-reviewer = PASS-with-notes. [R1, Medium] The pre-existing 'users can update their own profile' policy (20260627000001) has no column list and table-level UPDATE grants (20260630000002) extend to new columns, so ANY authenticated user can flip their own is_agent — verified live against the local stack. Cosmetic today (nothing gates on the flag), but it is a trust-signaling column and becomes a real bypass the moment a future feature (e.g. the deferred capacity-exclusion toggle) reads it. Cheapest fix with repo precedent: add 'revoke update (is_agent) on public.profiles from authenticated;' to the migration. [R2, Low] profiles-is-agent.integration.test.ts never attempts the UPDATE it should guard against and never tests co-member SELECT; add an update-rejected case after R1. Backfill no-op safety, SELECT scoping, grants coverage all confirmed clean. fable design review (spec/ux-principles.md) = 1 violation + 1 minor. [D1] story-card/story-list-row assignee chip changed from size-5 rounded-full circle to h-5 px-1.5 rounded-full PILL for all assignees — violates 'rounded-full is reserved for genuinely circular elements' and visually changes every human assignee chip; keep the human case as the original circle and widen only for agents (with rounded, not rounded-full). [D2] compact AgentIndicator needs role=img alongside aria-label for reliable screen-reader announcement. Select-option '(agent)' suffix, activity/history badge placement, member-list badge, and the deliberate tracker-parity divergence are all fine. Merge and remote migration stay HELD until these are triaged with the owner.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
profiles.is_agent added with backfill and a column-list UPDATE grant (users cannot set is_agent on themselves — the original table-level grant would have allowed it; verified by a 42501-asserting integration test against a reset local DB). Agent badge/icon rendered in member list, board assignee chips (circle preserved for humans), assignee selects, activity feed, and story history. claude_agent naming unified across spec/mcp.md and apps/mcp/README.md. Implemented by @gpt-5.6-sol; rls-security-reviewer PASS-with-notes and fable design review findings (4) all fixed by @claude-fable-5. Verified: full suite incl. real-DB 494/494, lint clean. Committed in bf20a77; remote migration rides the TASK-96 deploy pipeline on next push; owner visual check deferred to TASK-94.
<!-- SECTION:FINAL_SUMMARY:END -->
