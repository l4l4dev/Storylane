#!/usr/bin/env bash
# The Codex agent definitions are the one pair of agent configs that cannot be a
# symlink: Codex wants TOML, Claude Code wants Markdown with YAML frontmatter.
# Everything else under .agents/ and AGENTS.md is symlinked to its .claude
# counterpart. So this compares the instruction bodies instead — a plain `diff`
# of the two files reports format noise forever and hides real drift, which is
# how `.Codex/commands/db-migrate.md` stayed wrong until TASK-202.
set -euo pipefail

cd "$(dirname "$0")/.."

# Body of a Claude agent file: everything after the closing --- of the frontmatter.
md_body() {
  awk 'NR==1 && /^---$/ {fm=1; next} fm && /^---$/ {fm=0; body=1; next} body' "$1"
}

# Body of a Codex agent file: the developer_instructions triple-quoted string.
toml_body() {
  awk '/^developer_instructions = """$/ {body=1; next} body' "$1" | sed 's/"""$//'
}

# Leading/trailing blank lines are an artifact of each format's delimiters.
trim() {
  awk 'NF {p=1} p' | awk '{lines[NR]=$0} END {last=NR; while (last>0 && lines[last]=="") last--; for (i=1;i<=last;i++) print lines[i]}'
}

status=0
for agent in fable-advisor rls-security-reviewer; do
  md=".claude/agents/${agent}.md"
  toml=".codex/agents/${agent}.toml"
  if diff -u <(md_body "$md" | trim) <(toml_body "$toml" | trim) > /tmp/agent-parity-$$.diff; then
    echo "ok: ${agent} bodies match"
  else
    echo "DRIFT: ${md} and ${toml} instruction bodies differ" >&2
    cat /tmp/agent-parity-$$.diff >&2
    status=1
  fi
  rm -f /tmp/agent-parity-$$.diff
done

exit $status
