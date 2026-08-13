---
name: learnings-streaming-shell-announce-once
description: Route loading.tsx + inner Suspense fallback each carrying a live "Loading" span — how the announcements actually fire, and why the duplicate is acceptable (TASK-233 board streaming)
metadata:
  type: project
---

Approved pattern (TASK-233, board page): the page awaits only the fast cached
project row, renders the real title shell, and streams the heavy content behind
one inner `<Suspense>` whose fallback reuses the route `loading.tsx` skeleton
(exported `BoardContentSkeleton`). StoryPeekHost stays inside that single
boundary, never behind a nested one (its own mount-lifecycle comment).

**Why:** the live-region mechanics are non-obvious and will recur when other
pages adopt the same shell+Suspense split:
- Hard load (SSR): `loading.tsx`'s sr-only `role="status"` span is part of the
  initial HTML — live regions present at load do NOT announce their initial
  content. No announcement, no duplicate.
- Client-side navigation: both spans mount dynamically in sequence
  (loading.tsx first, then the shell's inner fallback) — worst case the same
  polite phrase queues twice. Identical text, polite priority: acceptable,
  not a blocking finding.
- Dropping either span is worse: removing loading.tsx's leaves the pre-shell
  window silent; removing the inner one leaves in-shell re-suspends silent.

**How to apply:** when reviewing another page adopting this pattern, check
(1) the fallback skeleton is the SAME component the route loading.tsx uses
(two divergent skeletons = layout jump at the loading→shell handoff,
principle 3), (2) the shell's awaited data is genuinely fast/cached, (3) any
component managing client mount state across refreshes stays outside nested
Suspense, (4) errors thrown in the streamed subtree still land in the same
segment error.tsx as before. Duplicate identical polite announcements are not
worth churn. See [[review-checklists]].
