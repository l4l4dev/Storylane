---
id: TASK-216
title: Agent config parity check ignores frontmatter/TOML metadata drift
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-27 06:16'
updated_date: '2026-08-03 03:18'
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
- [x] #1 check-agent-config-parity.sh extracts name and description (or their TOML equivalents) from both the Markdown frontmatter and the TOML file for each agent pair
- [x] #2 The script compares that metadata in addition to the instruction body and fails with a clear message on mismatch
- [x] #3 Changing only a Claude agent's frontmatter name or description (leaving the TOML untouched) makes the job fail
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
check-agent-config-parity.sh now compares name and description alongside the instruction bodies. Both fields sit outside the previously compared regions — md_body() strips all frontmatter and toml_body() starts at developer_instructions — so either could change on one side and the job still printed ok. They decide which agent a trigger selects, so drift there means Claude and Codex silently run different agents.

The YAML and TOML spellings of the same string are not textually equal, which a naive comparison would report as permanent, unfixable-looking drift: YAML quotes only when it must (a description containing ": " forces it, and these read "Use when: ..."), TOML always quotes. Both sides are unquoted before comparison, trailing whitespace is trimmed, and a block scalar (> or |) fails with an explicit UNREADABLE message rather than silently comparing the indicator character — all three from /code-review findings.

Verified: changing only the Markdown name, and only the description, each exits 1 and prints both values; a YAML-quoted description and a trailing space both still pass; a block scalar exits 1 with the explanation.
<!-- SECTION:FINAL_SUMMARY:END -->
