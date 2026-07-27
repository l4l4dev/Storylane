---
id: TASK-203
title: Trim the SessionStart hook's per-session token cost
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-26 16:01'
updated_date: '2026-07-27 00:45'
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
- [ ] #1 The per-session injected context is materially smaller than 11.2 KB
- [ ] #2 The cross-cutting relations that sessions must not re-derive are still reachable — moved, not deleted
- [ ] #3 ARCHITECTURE.md no longer duplicates what spec/ owns; it points instead
- [ ] #4 Spent single-task verdicts under .claude/agent-memory/fable-advisor/ are archived, leaving the learnings-* and review-* files
- [ ] #5 ARCHITECTURE.md's closing pointer to TASK.md is resolved (TASK-185 retires that file)
- [ ] #6 The Codex mirror .codex/hooks.json carries the same SessionStart hook — it changes with .claude/settings.json, not after it
<!-- AC:END -->
