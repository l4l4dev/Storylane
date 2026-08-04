---
id: TASK-229
title: Member removal floods the project activity feed with per-story unassign rows
status: In Progress
assignee:
  - '@claude-opus-5'
created_date: '2026-08-03 14:27'
updated_date: '2026-08-04 08:24'
labels: []
milestone: m-2
dependencies: []
priority: medium
ordinal: 1800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Removing a project member unassigns every story they held, via the composite FK's ON DELETE SET NULL (20260730030000). Since TASK-224 those UPDATEs are logged, so a member holding 30 stories produces 30 story.assignee_changed rows in one transaction, all rendering as `Owner unassigned "..." from Rin`.

apps/web/app/projects/[id]/activity/page.tsx pages 20 rows at a time, so one removal buries a page and a half of real history. This is the readability failure TASK-225 was filed for, in a new place.

The owner ruled (2026-08-03) that the rows stay as they are for now: they are true, and "these 30 stories need a new owner" is exactly what a team must learn from a removal. TASK-224 shipped that way deliberately — being noisy is strictly better than the silence it replaced.

Why the TASK-225 marker does not simply solve it: storylane.bookkeeping hides a row from BOTH the project feed and the story-detail panel. Story detail is where "why did this story lose its assignee?" gets answered, so hiding it there re-creates half of the bug TASK-224 just fixed. The two readers want different things from the same rows, which the marker cannot express.

So the fix is a feed-side collapse, not suppression — e.g. the feed groups a run of rows sharing (action, actor, transaction) into one entry ("Owner removed Rin, unassigning 30 stories") while every other reader keeps the individual rows. Note TASK-225 rejected time-window grouping as a heuristic; since 20260802000000 rows carry distinct clock_timestamp values, so grouping needs an explicit shared key, not a timestamp window.

Decide the shape before implementing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A decision is recorded on how the feed groups the cascade rows, and why that key rather than a timestamp window
- [x] #2 Removing a member holding N stories produces one entry in the project activity feed, not N
- [x] #3 The story-detail panel of each affected story still shows its own unassignment — the collapse is feed-only
- [x] #4 Every other activity_logs reader (MCP get_story, burndown) is unaffected, and checked
- [x] #5 A test covers a multi-story member removal end to end
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTED 2026-08-04 in supabase/migrations/20260804073330_collapse_member_removal_in_feed.sql (advisor-reviewed before implementation; verdict = approved with corrections).

AC#1 (the decision, recorded in the migration header rather than here so a future session does not re-derive it), in two tiers:
 1. Grouping in the READER cannot work at all: the feed is keyset-paginated, so a 30-row cascade spanning a page boundary collapses to '20 stories' on one page and '10' on the next. The count is only true if the fold happens at write time.
 2. Identifying the rows cannot use a time window: since 20260802000000 rows carry distinct clock_timestamp values, and TASK-225 rejected window heuristics. So remove_member sets a gen_random_uuid() token in storylane.feed_collapsed for the duration of its delete, and the cascade's rows carry it.
Rejected alternative also recorded: having the trigger infer a cascade from old.assignee_id no longer being a member — no session variable needed, but it is an inference, and it yields neither a group key nor a count.

Advisor corrections applied:
 - The count is taken AFTER the delete, from the marked rows, not before it. An uncommitted assignment holds KEY SHARE on the membership row (20260730030000), so the delete waits for it and the cascade then unassigns that story too — a pre-count would be short by exactly those.
 - The GUC and the payload key share one name (feed_collapsed) so the feed keeps a single filter as more collapse sources appear, instead of one .filter() per source.
 - The summary row must NOT carry feed_collapsed or the feed filter eats it along with the rows it speaks for. It carries removal_id (the same token) instead — the only way back to the rows it stands for, since the feed never fetches them.
 - Names stay ids-only (snapshotting was rejected: it violates the rule recorded at 20260803010000:5-13 and activity.ts:26-35). Wording reuses the existing 'someone' vocabulary rather than inventing 'a member'.
 - The summary is written even when story_count = 0 — nothing else records a removal at all (member.* actions did not exist before this). The count clause is what drops, not the entry.

Deviation from the advisor's letter, same intent: self-leave is distinguished by a self_leave boolean in the payload rather than by threading actorId through describeActivity. The reader selects the actor's display_name and not their id, so it cannot derive this; the boolean discloses nothing (it restates a comparison of two ids already in the row).

AC#4 (every other reader checked): story detail (apps/web/app/stories/[id]/actions.ts) and MCP get_story (apps/mcp/src/handlers.ts) filter bookkeeping only, so the per-story rows still show there; burndown (iterations/page.tsx) has an action whitelist that excludes assignee_changed. The summary row has story_id NULL, so it reaches none of the three (two key on story_id, the third on its whitelist) — it is feed-only by construction, not by filtering.

AC#5: apps/web/lib/utils/assignee-membership-fk.integration.test.ts covers a 3-story removal end to end and proves the one non-obvious premise — that set_config(..., is_local) is visible to the RI trigger the FK runs, so the cascade's UPDATEs actually carry the token. Also asserts the summary lacks the key, that the feed's two filters leave exactly one row, that story detail's query still returns each per-story row, and that an ordinary reassignment stays unmarked.

Also updated: spec/screens.md's activity row (the trigger header's own convention requires it when the feed's scope changes), apps/web/lib/utils/activity.ts (assigneeIdsIn collects removed_user_id, withAssigneeNames adds removed_name, describeActivity gains member.removed), the feed's server-side filter, and page.test.tsx.

KNOWN COST, flagged for the owner: on a self-leave the actor loses shares_project_with too, so the entry reads 'Someone left the project, unassigning N stories'. Not a regression — the existing per-story rows already read that way — and the permanent fix is a membership tombstone that opens profiles SELECT to former colleagues, which belongs in its own task, not here.

Verification: SUPABASE_INTEGRATION=1 pnpm test full suite 144 files / 1312 tests green (+10 new), lint + tsc clean. Applied with 'supabase migration up' rather than 'db reset' — the local DB holds other sessions' data. rls-security-reviewer pass: no issues found (no PII in the payload, the summary insert correctly precedes the exit guard so a raise rolls it back, the token is transaction-local and reset before the count, MATCH SIMPLE means story_id NULL skips the composite FK, and the SELECT policy is project_id-scoped so the row stays member-only).

/code-review high still needs the owner to run it (a model cannot start it).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Member removal now writes one member.removed summary row and marks the FK cascade's story.assignee_changed rows with a shared token, which the project feed filters server-side; every other reader is untouched. Decision and rejected alternatives recorded in the migration header. Verified with a 3-story end-to-end integration test (which also proves set_config is visible to the FK's RI trigger) plus the full suite: 144 files / 1312 tests green, lint + tsc clean, rls-security-reviewer clean.
<!-- SECTION:FINAL_SUMMARY:END -->
