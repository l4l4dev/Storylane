---
id: TASK-215
title: Agent config parity gate misses AGENTS.md/CLAUDE.md symlink drift
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-27 06:16'
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
- [ ] #1 Workflow trigger paths (push and pull_request) include AGENTS.md, CLAUDE.md, and every app-level instruction file that is supposed to be a symlink
- [ ] #2 check-agent-config-parity.sh (or a new check in the same job) asserts each expected instruction file is still a symlink resolving to its canonical sibling, and fails with a clear message if not
- [ ] #3 Replacing one of those symlinks with a plain file (even with identical content) makes the job fail
<!-- AC:END -->
