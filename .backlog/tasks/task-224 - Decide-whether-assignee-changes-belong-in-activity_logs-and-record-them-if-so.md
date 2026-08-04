---
id: TASK-224
title: 'Decide whether assignee changes belong in activity_logs, and record them if so'
status: Done
assignee:
  - '@claude-opus-5'
created_date: '2026-07-30 12:11'
updated_date: '2026-08-04 03:53'
labels: []
milestone: m-2
dependencies: []
priority: medium
ordinal: 1400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Raised by Codex on PR #13 (TASK-221) and left unresolved there because it turns on a spec reading, not on the FK.

spec/screens.md 'Conflict & failure rules' says the activity-log trigger 'records state/assignment events'. log_story_activity (20260727140000) watches state_id and iteration_id, so 'assignment' is satisfied by the iteration assignment it already logs — but the sentence sits in a list about which autosaved fields deserve an activity row, and assignee is one of the autosaved discrete fields (spec/screens.md 'Discrete fields'). Assignee changes have never produced an activity_logs row.

TASK-221 made this more visible without changing it: the composite FK's ON DELETE SET NULL now unassigns stories when a member is removed, and its one-time backfill cleared dangling assignees. Both are silent — the only trace of the backfill is a RAISE NOTICE count in the deploy log.

First step is the owner's ruling on which reading of the spec is intended. Only extend the trigger if the answer is 'assignee'; otherwise clarify the spec wording so the question does not come back.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The owner's reading of spec/screens.md's 'state/assignment events' is recorded, and the spec wording is made unambiguous either way
- [x] #2 If assignee changes are in scope: log_story_activity records them, including the ON DELETE SET NULL cascade from remove_member, with a test covering both the direct write and the cascade
- [ ] #3 If they are out of scope: no trigger change, and spec/rls.md or the migration notes why the cascade unassignment is deliberately unlogged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Reader survey (done 2026-08-03, before implementation):

| Reader | Effect of a new story.assignee_changed action |
|---|---|
| lib/utils/activity.ts describeActivity | falls through to `default:` ("performed story.assignee_changed on X") — NEEDS a case |
| app/stories/[id]/actions.ts | `.in("action", [...])` whitelist — NEEDS the new name added |
| app/projects/[id]/activity/page.tsx | no action filter, renders whatever describeActivity returns — no change |
| app/projects/[id]/iterations/page.tsx | whitelists the 4 burndown actions; assignee is not one — correctly excluded, no change |
| lib/utils/burndown.ts | only ever fed those 4 — no change |
| apps/mcp/src/handlers.ts getStory | no whitelist, picks it up automatically — no change |
| Slack outbox trigger | `when (new.action = 'story.state_changed' ...)` — no notification, no change |

`stories_log_activity` is `after insert or update on public.stories for each row`
with no column list (20260702000001), so only the function body changes; the
trigger itself is not recreated.

The composite FK `on delete set null (assignee_id)` on (project_id, assignee_id)
(20260730030000) performs a real UPDATE on stories, which fires that row
trigger — so the remove_member cascade is logged by the same branch, with
auth.uid() correctly resolving to the remover.

Steps:

1. Migration: `create or replace function public.log_story_activity()` — copy
   the CURRENT body (grep -ln "function public.log_story_activity"
   supabase/migrations/*.sql | tail -1 FIRST; PR #22 rewrites it) and add an
   `assignee_id is distinct from` branch writing `story.assignee_changed` with
   from/to ids AND from_name/to_name resolved from profiles, matching how
   story.state_changed stores state names rather than ids.
2. Verify whether move_story_to_project / copy_story_to_project clear
   assignee_id. If they do, decide there whether that row is real or
   bookkeeping — the storylane.bookkeeping marker (20260803000000) is the
   mechanism if it is. Not carrying the marker otherwise: no current
   bookkeeping path touches assignee_id.
3. describeActivity: assigned / unassigned / reassigned wordings, plus the
   null-actor cascade case.
4. Story-detail whitelist: add the action.
5. spec/screens.md:441 — rewrite "state/assignment events" to name the fields
   it means, so AC#1 cannot be re-litigated.
6. Tests: describeActivity unit cases; integration for the direct write and for
   the remove_member cascade.

Gates: rls-security-reviewer on the migration (project rule), then
/code-review high (owner-run), then PR. Not starting until PR #22 merges.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## AC#1 — owner's ruling (2026-08-03): assignee changes ARE in scope

The owner read spec/screens.md:441's "state/assignment events" as covering the
story's assignee, not only its iteration assignment. So log_story_activity gains
assignee_id, and the spec sentence is rewritten to say so without ambiguity.

Reasons recorded with the ruling:

- points already produces a row and assignee does not, though spec/screens.md:405
  lists both as autosaved Discrete fields. The asymmetry has no stated basis.
- My Work makes the assignee a load-bearing field in this product; "who took
  this" is exactly what a team reads a feed for.
- TASK-221's composite FK unassigns stories on ON DELETE SET NULL with no trace
  anywhere. Choosing the other reading would still have cost a written
  justification (this task's AC#3), so the cost gap between the readings is small.

## Tracker-parity check (spec/ux-principles.md "Tracker-parity verification")

Fetched from the 2024 Wayback capture of the Pivotal Tracker help site:

- `seeing_project_history` — "The Project History panel shows additions,
  updates, and deletions of project information ... the action that was
  performed". Not a whitelist of fields, and it explicitly calls out label
  changes ("If a project collaborator adds a new label, the label name will be
  shown in the project history item").
- `seeing_story_history` — "all of the activity that's taken place within the
  story". Again no field whitelist.
- `story_owners` — owners are first-class, and "If you click Start on a story,
  you will automatically become its owner", so ownership changes were routine
  history traffic rather than an edge case.

Conclusion: Tracker's history was broad by default; a state+iteration-only log
is the narrower behaviour, and recording assignee moves toward parity rather
than away from it. No deliberate divergence needed.

Noted, NOT in this task's scope: Tracker also logged label changes. Storylane
does not. Raise with the owner separately rather than widening this task.

## Sequencing constraint

This task must redefine log_story_activity, which the unmerged
fix/containerize-bookkeeping-marker branch (TASK-225, PR #22) also redefines.
Implementation waits for PR #22 to merge so the copied body is the current one
— the mistake doc-26 records (copying a stale body and silently dropping a
later guard) happens exactly here.

## rls-security-reviewer pass (2026-08-03) — no findings

Read-only review of 20260803010000_log_assignee_changes.sql. Verified points
worth not re-deriving:

- `public.profiles` SELECT is `using (true)` since 20260627000001 ("needed to
  render collaborators"), so resolving display_name inside the SECURITY DEFINER
  trigger discloses nothing that was not already readable. Not a new hole.
- `stories` UPDATE is gated by `project_role(project_id) in ('owner','member')`,
  and the trigger fires only on rows that passed RLS — the branch cannot be used
  to forge activity rows in a project the actor cannot write to.
- `stories.created_by` is `not null default auth.uid()` (20260627000005), so
  `coalesce(auth.uid(), new.created_by)` cannot violate activity_logs.actor_id.
- The remove_member cascade is safe: `select ... into` assigns NULL on zero rows
  rather than raising, so a missing profile cannot abort the removal's
  transaction. Trigger confirmed via pg_get_triggerdef to be AFTER INSERT OR
  UPDATE with no column list.
- The Slack outbox trigger is scoped to `new.action = 'story.state_changed'`, so
  story.assignee_changed enqueues nothing — matching "Slack notifications stay
  state-change-only".

## Findings from implementation

- move_story_to_project / copy_story_to_project INSERT a new row in the target
  project rather than updating project_id, so their non-member-assignee drop
  produces story.created and never touches this branch. No bookkeeping marker
  needed for them.
- The payload carries ids AND display names. story.state_changed stores names
  alone because a state name is unique per project; display names are not
  unique, so an id is what makes the row unambiguous.

## /code-review high (2026-08-03) — 3 findings

- MEDIUM, member removal floods the feed with one row per story: NOT fixed here.
  Owner ruled the rows stay — they are true, and the noise is strictly better
  than the silence TASK-224 replaced. The TASK-225 marker cannot express it
  because it hides a row from the story-detail panel too, which is where the
  question "why did this story lose its assignee?" gets answered. Filed as
  TASK-229 (feed-side collapse, not suppression).
- LOW, describeActivity branched on the display name: fixed. display_name has no
  non-empty CHECK and `authenticated` can PATCH its own, so assigning a story to
  a user with a blank name rendered as an UNASSIGNMENT. Presence now reads from
  from_id/to_id and names are labels only, with "someone" when a name is blank
  or its profile is gone.
- LOW, ARCHITECTURE.md still said the trigger watches state_id and iteration_id:
  fixed, and it now points at spec/screens.md as the duplicate list to keep in
  step.

## Codex review (2026-08-03) — P2, profile visibility. Adopted.

The payload originally snapshotted from_name/to_name. `profiles` SELECT has been
`id = auth.uid() or shares_project_with(id)` since 20260709000001 — the
rls-security-reviewer pass read the ORIGINAL `using (true)` policy in
20260627000001 and missed that it had been replaced, so its all-clear on this
exact point was wrong. Verified against the live DB (pg_policies).

Snapshotting meant a member who joined after someone left could read the former
member's display name from the audit row, though RLS would deny them the
profile itself.

Fixed by storing ids only and resolving names in each reader under its own RLS —
which is what the actor column has always done (`actor:profiles(display_name)`
falling back to "Someone"). `story.state_changed` stores state names directly
because states are not RLS-scoped; profiles are, and treating the two alike was
the mistake.

describeActivity needed no change: it already reads presence from the ids and
treats names as labels, so the readers fold resolved names into the payload
before rendering. Two pure helpers (assigneeIdsIn / withAssigneeNames) keep the
extraction testable without a Supabase client.

Lesson worth carrying: an rls-security-reviewer pass is not proof a policy is
current. Check `pg_policies` on the live DB, or grep for LATER migrations that
replace the policy — the same "find the current definition" discipline the
function bodies already require.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Assignee changes are in scope (AC#1 ruling): log_story_activity now writes story.assignee_changed on every assignee_id change, including the composite FK's ON DELETE SET NULL cascade from remove_member. spec/screens.md:441 names the four watched fields explicitly so the reading cannot be re-litigated, and ARCHITECTURE.md's list was brought in step.

The payload stores ids only. Codex found that snapshotting display names would leak a former member's name past the profiles RLS policy (id = auth.uid() or shares_project_with(id), 20260709000001); both readers now resolve the ids under their own RLS, as the actor embed already did.

Verified: 911 web unit tests pass (including 3 new feed tests that fail without the profiles resolution) plus 8 integration tests against the local DB covering the direct write and the remove_member cascade; lint and tsc clean. AC#3 does not apply — it was the out-of-scope branch of the ruling. The member-removal feed flood surfaced by /code-review is deliberately left as-is and tracked in TASK-229.
<!-- SECTION:FINAL_SUMMARY:END -->
