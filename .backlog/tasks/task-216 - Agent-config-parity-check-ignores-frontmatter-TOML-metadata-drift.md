---
id: TASK-216
title: Agent config parity check ignores frontmatter/TOML metadata drift
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-27 06:16'
labels: []
milestone: m-2
dependencies: []
references:
  - 'https://github.com/l4l4dev/Storylane/pull/5#discussion_r3654000987'
priority: medium
type: bug
ordinal: 1370
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex review on PR #5 (chatgpt-codex-connector, P2): check-agent-config-parity.sh only compares instruction bodies — md_body() strips all YAML frontmatter and toml_body() starts at developer_instructions. If a Claude agent's frontmatter name or description changes without the mirrored TOML fields being updated, the check still prints ok, because both fields live outside the compared region. Since these fields are duplicated in the Codex TOML and drive agent identity/discovery, Claude and Codex can silently select different agents for the same trigger despite the parity job passing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 check-agent-config-parity.sh extracts name and description (or their TOML equivalents) from both the Markdown frontmatter and the TOML file for each agent pair
- [ ] #2 The script compares that metadata in addition to the instruction body and fails with a clear message on mismatch
- [ ] #3 Changing only a Claude agent's frontmatter name or description (leaving the TOML untouched) makes the job fail
<!-- AC:END -->
