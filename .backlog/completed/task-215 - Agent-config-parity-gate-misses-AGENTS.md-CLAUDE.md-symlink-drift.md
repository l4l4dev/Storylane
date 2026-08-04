---
id: TASK-215
title: Agent config parity gate misses AGENTS.md/CLAUDE.md symlink drift
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-27 06:16'
updated_date: '2026-08-03 03:18'
labels: []
milestone: m-2
dependencies: []
references:
  - 'https://github.com/l4l4dev/Storylane/pull/5#discussion_r3654000985'
priority: medium
type: bug
ordinal: 1360
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex review on PR #5 (chatgpt-codex-connector, P2): the parity workflow's push/pull_request triggers only watch .claude/agents/**, .codex/agents/**, and the script/workflow files themselves. AGENTS.md, CLAUDE.md, and the app-level equivalents are not in the trigger paths and their symlink mode is never asserted. A write-then-rename tool (e.g. backlog agents --update-instructions) can replace a symlink with a regular file, and this gate neither fires on that path nor detects the mode change — so the exact drift TASK-202 introduced this gate to prevent can silently return.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Workflow trigger paths (push and pull_request) include AGENTS.md, CLAUDE.md, and every app-level instruction file that is supposed to be a symlink
- [x] #2 check-agent-config-parity.sh (or a new check in the same job) asserts each expected instruction file is still a symlink resolving to its canonical sibling, and fails with a clear message if not
- [x] #3 Replacing one of those symlinks with a plain file (even with identical content) makes the job fail
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The parity workflow now triggers on the symlinked instruction files themselves (AGENTS.md, CLAUDE.md, apps/*/AGENTS.md, apps/*/CLAUDE.md, apps/*/.claude/**, .agents/**), and check-agent-config-parity.sh asserts each expected link is still a symlink pointing at its canonical sibling — with the restore command in the failure message.

The expected-link list is written out rather than derived from git ls-files: a mode already committed as a regular file would drop out of a derived list and take its own failure with it, which is precisely the drift being guarded. Trigger paths watch the LINK, not the target, because a tool that replaces a symlink with a regular file touches only the link.

Verified by breaking each case and restoring: AGENTS.md replaced with an identical-content regular file exits 1 with NOT A SYMLINK; moving apps/ios/CLAUDE.md away leaves the link text correct but exits 1 with DANGLING (a /code-review finding — the first version reported ok for a broken link, so AC#2 was not actually met). A script-driven cross-check confirms all five checked links match a trigger path.
<!-- SECTION:FINAL_SUMMARY:END -->
