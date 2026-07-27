---
id: TASK-202
title: Stop AGENTS.md drifting from CLAUDE.md — one source for the shared rules
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-26 16:00'
labels:
  - docs
milestone: m-2
dependencies: []
references:
  - CLAUDE.md
  - AGENTS.md
ordinal: 1150
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
AGENTS.md (Codex's instruction file) is a hand-maintained copy of CLAUDE.md and has fallen behind it. As of 2026-07-26 it is missing the entire Backlog Milestone Policy section, and it still carries a superseded rule — `For every user request in this project, run backlog instructions overview before answering` — which CLAUDE.md narrowed in commit cd100cb. Codex-assigned tasks (@codex-gpt-5, @gpt-5.6-sol) therefore run under stale rules.

Re-syncing by hand fixes today's diff but guarantees the same drift returns. The outcome wanted here is a structure where the shared rules physically cannot diverge — the genuinely tool-specific parts (the two files' titles, the CLAUDE.md-vs-AGENTS.md sub-file pointers) are the only content allowed to differ.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The rules shared by both tools live in exactly one file; neither instruction file restates them
- [ ] #2 Tool-specific content (title, per-directory sub-file naming) is the only remaining difference
- [ ] #3 The stale 'For every user request' rule is gone from the Codex side
- [ ] #4 The Backlog Milestone Policy reaches the Codex side
- [ ] #5 Both Claude Code and Codex still pick up the rules from their own entry file
<!-- AC:END -->
