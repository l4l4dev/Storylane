---
id: TASK-202
title: Stop AGENTS.md drifting from CLAUDE.md — one source for the shared rules
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-26 16:00'
updated_date: '2026-07-27 02:50'
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
- [x] #1 The rules shared by both tools live in exactly one file; neither instruction file restates them
- [x] #2 Tool-specific content (title, per-directory sub-file naming) is the only remaining difference
- [x] #3 The stale 'For every user request' rule is gone from the Codex side
- [x] #4 The Backlog Milestone Policy reaches the Codex side
- [ ] #5 Both Claude Code and Codex still pick up the rules from their own entry file
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause was broader than the task described: the Codex mirror was made by find/replace and three of its targets did not exist.

Found:
- apps/web/AGENTS.md and apps/ios/AGENTS.md were never created, so root AGENTS.md pointed Codex at two missing files — the per-directory Web/iOS conventions have never reached Codex at all.
- .agents/skills/advisor/SKILL.md was a copy of .claude/skills/advisor/SKILL.md differing by one line (CLAUDE.md vs AGENTS.md).
- .codex/agents/rls-security-reviewer.toml pointed at `.Codex/commands/db-migrate.md` — wrong case and a directory that does not exist; the real file is .claude/commands/db-migrate.md.
- .codex/agents/fable-advisor.toml's body differed from .claude/agents/fable-advisor.md's by the same one line.

Done:
- AGENTS.md is now a symlink to CLAUDE.md at the root and in apps/web, apps/ios (git mode 120000). Both sub-directory convention files were already tool-agnostic, so nothing had to be split out.
- CLAUDE.md's title is tool-neutral and carries a comment telling future maintainers not to turn the symlink back into a copy. Verified nothing was lost: the only content unique to the old AGENTS.md was the stale backlog-instructions rule, the Codex title, the sub-file pointer, and the Tech Stack table that commit 0e2539f deliberately removed from CLAUDE.md.
- .agents/skills/advisor/SKILL.md is a symlink to the .claude one; the shared line is now tool-neutral.
- The two .codex/agents/*.toml files cannot be symlinked (TOML vs MD frontmatter). Their bodies are now byte-identical to the .claude ones and each carries a comment saying so, so `diff` detects drift.

Net -207 lines of duplicated instructions.

Left alone deliberately: .claude/agents/fable-advisor.md still declares `model: fable`, which will break when Fable is retired — out of scope here, flagged to the owner.

---

/code-review round 2 returned 4 findings, all applied:
- medium — the .codex TOML comments claimed `diff` catches drift. It does not: it compares TOML against MD-frontmatter, so it reports format noise unconditionally, and the bodies were not byte-identical anyway (trailing newline, 1833 vs 1832 bytes). Replaced the claim with scripts/check-agent-config-parity.sh, which extracts and compares the two instruction bodies, plus .github/workflows/agent-config-parity.yml to run it. Verified both directions: passes on the current tree, and exits 1 pointing at the changed line when drift is injected.
- low — the CLAUDE.md comment said all three AGENTS.md symlinks land on the root file. They do not: apps/web and apps/ios point at their own sibling CLAUDE.md. Acting on the wrong description would have re-broken exactly what this task fixed. Comment corrected, and both sub-directory files now carry a note about their sibling symlink.
- low — the [[feedback-ask-before-creating-backlog-tasks]] wikilink pointed Codex at a Claude-only memory store. Rewritten as plain prose.
- low — `backlog agents --update-instructions` lists CLAUDE.md and AGENTS.md as separate targets that are now one inode, and a write-then-rename would replace the symlink with a copy. Warning added to the CLAUDE.md comment.

AC #5 is deliberately left unchecked: whether Codex follows the symlinks can only be confirmed by running Codex, which is the owner's step.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
AGENTS.md is a symlink to CLAUDE.md at the repo root and in apps/web and apps/ios, as is .agents/skills/advisor/SKILL.md — the shared rules now live in exactly one file per scope and cannot diverge. Removes 207 lines of duplicated instructions.

The mirror turned out to be find/replace output with three dead targets: apps/web/AGENTS.md and apps/ios/AGENTS.md were never created, so the per-directory conventions had never reached Codex at all, and .codex/agents/rls-security-reviewer.toml pointed at a '.Codex/commands/' path that does not exist.

The two .codex/agents/*.toml files cannot be symlinked across formats, so scripts/check-agent-config-parity.sh compares their instruction bodies and runs as its own CI workflow (green in 3-6s on every run since). It is glob-driven, so a new pair is covered when added, and a Codex agent with no .claude counterpart is reported as an error — both verified with injected drift and a throwaway orphan TOML.

Verified: all four symlinks resolve to the intended sibling; a line-by-line diff confirmed the only content unique to the old AGENTS.md was the superseded backlog rule, the Codex title, the sub-file pointer, and the Tech Stack table that 0e2539f deliberately removed.
<!-- SECTION:FINAL_SUMMARY:END -->
