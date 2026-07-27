---
id: TASK-203
title: Trim the SessionStart hook's per-session token cost
status: In Progress
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-26 16:01'
updated_date: '2026-07-27 01:51'
labels:
  - tooling
milestone: m-2
dependencies:
  - TASK-185
references:
  - .claude/settings.json
  - ARCHITECTURE.md
ordinal: 1180
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every session starts by injecting ARCHITECTURE.md in full via the SessionStart hook in .claude/settings.json — 11.2 KB, on top of CLAUDE.md's 10.0 KB. That is roughly 5-6k tokens spent before any work begins, on a project whose CLAUDE.md has an explicit Token Economy section.

The file calls itself 'a short map of how things connect' but has grown into a prose digest of SPEC.md: multi-hundred-character table rows restating velocity, RLS, My Work and container rules that spec/ already owns. The compact entity-relation diagram at the top is the part that actually earns a per-session slot — the rest is reference material that a session should read only when it touches that area.

Related: .claude/agent-memory/fable-advisor/ is 24 files / 72 KB, and the single-verdict files (task147, task186, task188, task192) have outlived their tasks — they inflate every advisor invocation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The per-session injected context is materially smaller than 11.2 KB
- [x] #2 The cross-cutting relations that sessions must not re-derive are still reachable — moved, not deleted
- [x] #3 ARCHITECTURE.md no longer duplicates what spec/ owns; it points instead
- [x] #4 Spent single-task verdicts under .claude/agent-memory/fable-advisor/ are archived, leaving the learnings-* and review-* files
- [x] #5 ARCHITECTURE.md's closing pointer to TASK.md is resolved (TASK-185 retires that file)
- [x] #6 The Codex mirror .codex/hooks.json carries the same SessionStart hook — it changes with .claude/settings.json, not after it
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
ARCHITECTURE.md is now two layers in one file, split by a `<!-- hook:end -->` marker. The hook pipes the file through `awk '/<!-- hook:end -->/{exit} {print}'` before jq, so only the top layer is injected; the rest is read on demand. A second file would have re-created the sync problem TASK-202 just removed, which is why the split is a marker rather than a new file.

Above the marker: the entity diagram, a one-line 'removed, do not reintroduce' list, and 10 invariants — the rules a session would silently violate without being told — each linking to its section below. Below: the former cross-layer table, regrouped into eight sections with the spec restatements cut down to pointers (the file's own header rule said 'this is not a copy of SPEC.md' and it had become one).

Sizes: injected 11,224 -> 3,703 bytes (67% smaller); the whole file 11,224 -> 9,869. Verified by running the hook command exactly as the runner does — valid JSON out, the marker line itself excluded from the payload. Content-loss checked against 17 key identifiers (split_story, set_story_state, notify_slack_event, iteration_goals, ...), all still present.

The stale 'Current phase' section (Tasks 6-13 numbering, pointer to TASK.md) is deleted rather than updated — it described the pre-Backlog era. That closes AC#5 without waiting on TASK-185, so the dependency on that task is moot.

Advisor memory: 9 verdicts whose task is Done moved to .claude/agent-memory/fable-advisor/archive/ (git mv, not deleted) and dropped from MEMORY.md; index 5,334 -> 3,230 bytes. project-my-work-column-management.md was kept despite being task-scoped because a live learnings-* file wikilinks to it. All 14 remaining index links verified to resolve.

Honest scope note: the advisor saving is index-only. MEMORY.md is what loads per invocation; the individual files were already read on demand, so archiving them buys cleaner memory selection rather than a large token cut. The real win in this task is the hook.

---

/code-review flagged that the inline hook pipeline fails silently: `awk ... | jq ...` exits with jq's status, so a renamed or moved ARCHITECTURE.md would still emit valid JSON with an empty context and every session would start with no architecture map and no signal. Deleting the marker had the mirror-image problem — awk would print the whole file and quietly undo the saving.

Moved the pipeline into scripts/session-context.sh (set -euo pipefail) and pointed both hook configs at it. It now exits 1 with a named reason if ARCHITECTURE.md is missing or if the marker is gone. Verified by deleting the marker: refuses with 'refusing to inject the whole file', exit 1; restored and re-verified.

Also hardened scripts/check-agent-config-parity.sh, whose agent list was hardcoded to today's two pairs: it now iterates .codex/agents/*.toml, so a new pair is covered as soon as it is added, and reports a Codex agent with no .claude counterpart as an error. Verified both ways with a throwaway orphan-test.toml.
<!-- SECTION:NOTES:END -->
