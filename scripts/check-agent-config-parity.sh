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

# name/description live OUTSIDE both compared bodies — in the Markdown
# frontmatter and as top-level TOML keys — so body parity alone let them drift.
# They decide which agent gets selected for a trigger, so Claude and Codex
# disagreeing here means the two harnesses quietly run different agents.
# Prints the value, or the literal BLOCK_SCALAR_UNSUPPORTED if the field uses a
# folded/literal block (`>`, `|`), which this comparison cannot read.
md_field() {
  local raw
  raw="$(awk -v key="$2" '
    NR==1 && /^---$/ {fm=1; next}
    fm && /^---$/ {exit}
    fm && index($0, key ":") == 1 { print substr($0, length(key) + 2); exit }
  ' "$1")"

  raw="${raw#"${raw%%[![:space:]]*}"}"
  raw="${raw%"${raw##*[![:space:]]}"}"

  case "$raw" in
    ">"|"|"|">-"|"|-"|">+"|"|+") printf 'BLOCK_SCALAR_UNSUPPORTED'; return ;;
  esac

  # YAML only quotes when it has to — a description containing ": " forces it,
  # and Claude agent descriptions routinely read "Use when: ...". TOML always
  # quotes. Unquoting both sides is what stops that difference reporting as
  # drift between two identical strings, which is unfixable-looking in CI.
  #
  # The value has to be read the way YAML reads it, not as raw line text. In a
  # PLAIN scalar an unquoted " #" starts a comment, so `description: fix #123`
  # is the value "fix" to every real parser. Comparing the raw line would match
  # a TOML string spelled "fix #123" and call two genuinely different values
  # equal — the one failure direction this gate exists to prevent.
  case "$raw" in
    '"'*)
      raw="${raw#\"}"
      raw="${raw%\"*}"
      raw="${raw//\\\"/\"}"
      ;;
    "'"*)
      raw="${raw#\'}"
      raw="${raw%\'*}"
      raw="${raw//\'\'/\'}"
      ;;
    *)
      raw="${raw%% #*}"
      raw="${raw%"${raw##*[![:space:]]}"}"
      ;;
  esac
  printf '%s' "$raw"
}

toml_field() {
  # Only the top-level scalar form `key = "..."`, which is all these files use.
  # \" is unescaped so a description containing a quote compares equal to its
  # Markdown twin rather than reporting permanent drift.
  awk -v key="$2" '
    index($0, key " = \"") == 1 {
      line = substr($0, length(key) + 5)
      sub(/"$/, "", line)
      print line
      exit
    }
  ' "$1" | sed 's/\\"/"/g'
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

  for field in name description; do
    md_value="$(md_field "$md" "$field")"
    toml_value="$(toml_field "$toml" "$field")"
    if [ "$md_value" = "BLOCK_SCALAR_UNSUPPORTED" ]; then
      echo "UNREADABLE: ${md} writes ${field} as a YAML block scalar (> or |)" >&2
      echo "  this check only reads single-line values — put it on one line" >&2
      status=1
    elif [ -z "$md_value" ] || [ -z "$toml_value" ]; then
      echo "MISSING: ${agent} has no ${field} in $([ -z "$md_value" ] && echo "$md" || echo "$toml")" >&2
      status=1
    elif [ "$md_value" != "$toml_value" ]; then
      echo "DRIFT: ${agent} ${field} differs" >&2
      echo "  ${md}: ${md_value}" >&2
      echo "  ${toml}: ${toml_value}" >&2
      status=1
    else
      echo "ok: ${agent} ${field} matches"
    fi
  done
done

# Everything else that mirrors a .claude file IS a symlink, so there is no body
# to compare — the only thing that can rot is the link itself. A tool that
# writes-then-renames (backlog agents --update-instructions is the one that bit
# us) leaves a regular file with identical content, which no content check can
# see and which stops tracking its source from the next edit on.
#
# The list is explicit rather than derived from `git ls-files -s`: a mode that
# has already been committed as a regular file would drop out of a derived list
# and take the failure with it, which is exactly the drift this guards.
declare -a EXPECTED_LINKS=(
  "AGENTS.md:CLAUDE.md"
  "apps/ios/AGENTS.md:CLAUDE.md"
  "apps/web/AGENTS.md:CLAUDE.md"
  ".agents/skills/advisor/SKILL.md:../../../.claude/skills/advisor/SKILL.md"
  "apps/web/.claude/agent-memory:../../../.claude/agent-memory"
)

for entry in "${EXPECTED_LINKS[@]}"; do
  link="${entry%%:*}"
  want="${entry#*:}"
  if [ ! -e "$link" ] && [ ! -L "$link" ]; then
    echo "MISSING: ${link} does not exist — it must be a symlink to ${want}" >&2
    status=1
  elif [ ! -L "$link" ]; then
    echo "NOT A SYMLINK: ${link} is a regular file; it must be a symlink to ${want}" >&2
    echo "  restore with: rm '${link}' && ln -s '${want}' '${link}'" >&2
    status=1
  else
    got="$(readlink "$link")"
    if [ "$got" != "$want" ]; then
      echo "WRONG TARGET: ${link} points at ${got}, expected ${want}" >&2
      status=1
    elif [ ! -e "$link" ]; then
      # -e follows the link, so this is the dangling case: the text is still
      # right but the sibling it names has been renamed or deleted out from
      # under it, and every harness reading through the link now gets nothing.
      echo "DANGLING: ${link} -> ${want}, but that target does not exist" >&2
      status=1
    else
      echo "ok: ${link} -> ${want}"
    fi
  fi
done

exit $status
