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

# Driven off .codex/*.toml rather than a hardcoded list, so a new pair is
# covered the moment it is added. .claude is canonical, so a Claude-only agent
# is fine; a Codex agent with no Claude counterpart is not.
status=0
shopt -s nullglob
tomls=(.codex/agents/*.toml)
if [ ${#tomls[@]} -eq 0 ]; then
  echo "no .codex/agents/*.toml found — did the directory move?" >&2
  exit 1
fi

for toml in "${tomls[@]}"; do
  agent="$(basename "$toml" .toml)"
  md=".claude/agents/${agent}.md"
  if [ ! -f "$md" ]; then
    echo "MISSING: ${toml} has no counterpart at ${md}" >&2
    status=1
    continue
  fi
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
