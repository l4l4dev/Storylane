---
name: learnings-collapse-at-write-time
description: Keyset-paginated feeds cannot group rows in the reader — collapse at write time behind an explicit token, and never snapshot display names into activity payloads
metadata:
  type: feedback
---

Any "collapse N rows into one entry" request on `/projects/[id]/activity` must be solved at
write time (a marker on the noisy rows + one summary row), never by grouping in the reader.

**Why:** the feed is keyset-paginated at 20 rows (`apps/web/app/projects/[id]/activity/page.tsx`),
so a run of rows can straddle a page boundary and reader-side grouping would report a split,
wrong count. The same file already filters `payload->>bookkeeping` server-side for exactly this
reason (short pages break the lookahead that drives the Newer/Older links). Timestamp windows are
also out: since 20260802000000 rows in one transaction carry distinct `clock_timestamp` values
(TASK-225 rejected the heuristic), so the group key has to be an explicit value written into the
payload — a per-call token is the cheapest one, and counting the rows carrying that token after
the write is the only count that is exact under a concurrent write.

Two keys, not one: `bookkeeping` hides a row from BOTH the feed and the story-detail panel, so a
feed-only collapse needs its own payload key that no other reader filters. New readers then
default to *showing* the row, which is the safe direction for rows that are true.

**Never snapshot `display_name` into an activity payload.** `profiles` SELECT is
`id = auth.uid() or shares_project_with(id)` (20260709000001) and the writers are SECURITY
DEFINER, so a stored name outlives the membership that authorised reading it. Recorded twice:
`supabase/migrations/20260803010000_log_assignee_changes.sql` header and
`apps/web/lib/utils/activity.ts` (`assigneeIdsIn` doc comment). Consequence to accept, not to
work around: after a removal the person's name resolves for nobody, so copy must read correctly
with the existing `"someone"` / `"Someone"` fallbacks. The principled fix (a membership tombstone
readable by former co-members) is a separate task — propose it, don't smuggle it in.

**How to apply:** any plan that says "the feed groups rows" or "store the name so the feed can
show it" gets sent back to this shape. See [[review-checklists]].
