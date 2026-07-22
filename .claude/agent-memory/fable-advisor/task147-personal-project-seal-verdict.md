---
name: task147-personal-project-seal-verdict
description: 2026-07-22 TASK-147 (personal project seal-every-seam) pre-implementation review — approve-with-changes; move/copy-target exclusion reopens a locked doc-11 D1 decision
metadata:
  type: project
---

Reviewed the implementer's audit + fix plan for TASK-147 before any code. Verdict:
**修正付き承認**. All 6 audited seams (promote_story_to_epic delete-cascade,
StoryFields/TransitionButtons leaking tracker fields, layout.tsx missing
is_personal redirect, dual membership-growth paths, MCP separate-account
confirmation, getMoveTargetProjects name leak) were verified directly against
current code and are real.

**Central finding — do not let this slide through as "in scope per seal-every-
seam intent":** the plan's "extra finding #6" (exclude the hidden personal
project from `getMoveTargetProjects`) directly reverses a decision doc-11 D1
explicitly locked with an anti-relitigation note: archived doc-11 line ~169,
"'My Tasks' stays a move/copy target. Decided **intentional**; note it in the
task's acceptance criteria **so it isn't re-flagged**." `spec/screens.md:36`
and `spec/features.md:148-149` both still say "it stays a valid move/copy
target." TASK-147's own 8 ACs do NOT include this — it's the auditing agent's
own scope addition. This needs an explicit owner decision before
implementation, not silent inclusion. If approved: (a) update both spec
sections with a reversal-rationale comment (same pattern doc-11 D1 itself used
when IT reversed doc-8's "no flag" call), (b) a client-side dropdown filter
alone is NOT enough — `move_story_to_project`/`copy_story_to_project`
(`supabase/migrations/20260719000011_reanchor_story_ops.sql:195,313`) have
zero `is_personal` guard today, so the RPC itself must also reject an
is_personal target, mirroring finding #1's own "UI-hide alone doesn't close
an RPC seam" lesson.

AC#4 (invite_member is_personal guard) is different: it IS in TASK-147's own
ACs, so pre-authorized. But it likewise reverses doc-11 D1's "invites are
still allowed" — the plan must still add the spec-update step (screens.md
Onboarding + features.md Personal project section) that doc-11 D1's own
process required, which the current plan omits.

Other required fixes (smaller, all confirmed against code):
- `project_members` lockdown must **drop the INSERT policy** ("owners can add
  members") **and** revoke the grant — TASK-110/115 precedent
  (`20260722000005_project_states_revoke_direct_insert.sql`) always does both;
  plan only mentioned the revoke.
- `getMoveTargetProjects` fix: don't attempt a PostgREST `.eq("projects.is_
  personal", ...)` filter on the embedded resource — this codebase has zero
  `!inner` usage anywhere and it won't reliably filter a left join. Reuse the
  exact JS-side pattern already shipped in `my-work/page.tsx`/`dashboard/page.
  tsx`/`sidebar-data.ts`: select `is_personal, created_by` and filter
  `p.is_personal && p.created_by === user.id` in the mapped result.
- `TransitionButtons`' `isPersonal` prop only truly needs threading from
  `story-detail-panel.tsx` (has `isPersonalProject` already) — once the
  layout.tsx redirect lands, `story-list-row.tsx` (project board) never
  renders for a personal project, so that call site can hardcode `false`.
  Don't over-thread it everywhere.
- Debug page (AC#6): the page itself, not just the link, must `notFound()`
  when `NODE_ENV === "production"` (matches `layout.tsx`'s existing idiom) —
  a hidden link alone doesn't stop a direct URL guess in prod. Use the normal
  RLS-scoped client, not service-role.

Confirmed no problem: layout.tsx single-choke redirect (Server Component
`redirect()` throws before children render, no `is_personal` reference
anywhere under `app/projects/[id]/` today, no conflicting flow); admin/
service-role test fixtures inserting into `project_members` directly are
unaffected by revoking the `authenticated` grant (same as every prior RPC
lockdown this session); hiding (not disabling) Points/Epic in StoryFields is
the ux-principles principle-1-COMPLIANT choice (disabled-but-visible is the
violation, not hiding).

Related: [[doc15-my-work-redesign-verdict]], [[review-sharp-edges]],
[[owner-review-preferences]].
