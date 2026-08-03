#!/usr/bin/env bash
# The Codex agent definitions are the one pair of agent configs that cannot be a
# symlink: Codex wants TOML, Claude Code wants Markdown with YAML frontmatter.
# Everything else under .agents/ and AGENTS.md is symlinked to its .claude
# counterpart. So this compares the instruction bodies instead — a plain `diff`
# of the two files reports format noise forever and hides real drift, which is
# how `.Codex/commands/db-migrate.md` stayed wrong until TASK-202.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

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
# These two extractors accept an explicitly listed subset of YAML/TOML and
# reject everything else by name. That direction is deliberate: this is not a
# parser, and the failures worth catching are the ones where a malformed file
# yields a value that happens to equal its counterpart — the gate then reports
# ok on a config no harness can load. Guessing at unlisted syntax is what
# produces those; refusing it cannot.
#
# Accepted: a plain scalar, or a quoted scalar optionally followed by a
# comment. Block scalars, unterminated quotes and junk after the closing quote
# all come back as a sentinel the caller reports by name.
MALFORMED_SCALAR="MALFORMED_SCALAR"
BLOCK_SCALAR="BLOCK_SCALAR_UNSUPPORTED"

# YAML only quotes when it has to — a description containing ": " forces it,
# and Claude agent descriptions routinely read "Use when: ...". TOML always
# quotes. Unquoting both sides is what stops that difference reporting as drift
# between two identical strings, which is unfixable-looking in CI.
md_field() {
  local raw pat_dq pat_sq
  raw="$(awk -v key="$2" '
    NR==1 && /^---$/ {fm=1; next}
    fm && /^---$/ {exit}
    fm && index($0, key ":") == 1 { print substr($0, length(key) + 2); exit }
  ' "$1")"

  raw="${raw#"${raw%%[![:space:]]*}"}"
  raw="${raw%"${raw##*[![:space:]]}"}"

  case "$raw" in
    ">"*|"|"*) printf '%s' "$BLOCK_SCALAR"; return ;;
  esac

  pat_dq='^"((\\.|[^"\\])*)"[[:space:]]*(#.*)?$'
  pat_sq="^'((''|[^'])*)'[[:space:]]*(#.*)?\$"
  case "$raw" in
    '"'*)
      [[ $raw =~ $pat_dq ]] || { printf '%s' "$MALFORMED_SCALAR"; return; }
      raw="${BASH_REMATCH[1]//\\\"/\"}"
      ;;
    "'"*)
      [[ $raw =~ $pat_sq ]] || { printf '%s' "$MALFORMED_SCALAR"; return; }
      raw="${BASH_REMATCH[1]//\'\'/\'}"
      ;;
    *)
      # In a PLAIN scalar an unquoted " #" starts a comment, so
      # `description: fix #123` is the value "fix" to every real parser.
      # Comparing the raw line instead would match a TOML string spelled
      # "fix #123" and call two genuinely different values equal.
      raw="${raw%% #*}"
      raw="${raw%"${raw##*[![:space:]]}"}"
      # A plain scalar may not contain ": " or end in ":" — YAML reads that as
      # a nested mapping and refuses the file. `description: Use when: ...` is
      # the spelling these agents reach for, and it needs quoting to be legal;
      # returning the raw text would match a quoted TOML twin and pass a file
      # nothing can load.
      case "$raw" in
        *": "*|*:) printf '%s' "$MALFORMED_SCALAR"; return ;;
      esac
      ;;
  esac
  reject_escapes "$raw"
}

# The two formats disagree about backslashes: TOML decodes \n to a newline
# while YAML single quotes keep it literal, so the same six characters mean
# different things and comparing them as text would call them equal. Rather
# than implement each format's escape table — the point where "this is not a
# parser" stops being a simplification — anything still carrying a backslash
# after decoding is refused. \" survives because it decodes to a plain quote in
# both formats, which is the only escape these files actually use.
reject_escapes() {
  case "$1" in
    *\\*) printf '%s' "$MALFORMED_SCALAR" ;;
    *) printf '%s' "$1" ;;
  esac
}

# The mirror of md_field: only `key = "..."`, optionally followed by a comment.
# An unterminated string here is the same trap in the other file — the old
# `sub(/"$/, ...)` left it unchanged, so it still equalled the valid YAML side.
toml_field() {
  local raw pat
  # Header only — everything before developer_instructions. The body is prose
  # that can legitimately contain a line like `description = "..."` as an
  # example, and reading that would let body text stand in for a top-level
  # field that has actually been deleted.
  local header hits
  header="$(awk '/^developer_instructions[[:space:]]*=/ {exit} {print}' "$1")"
  hits="$(printf '%s\n' "$header" | grep -c -E "^[[:space:]]*$2[[:space:]]*=" || true)"
  # TOML rejects a duplicated key outright, so taking the first match would let
  # a file Codex cannot load pass on the strength of its earlier copy.
  if [ "$hits" -gt 1 ]; then printf '%s' "$MALFORMED_SCALAR"; return; fi
  raw="$(printf '%s\n' "$header" | grep -m1 -E "^[[:space:]]*$2[[:space:]]*=" || true)"
  [ -n "$raw" ] || return 0
  raw="${raw%"${raw##*[![:space:]]}"}"
  # Built in double quotes for the key, so every backslash needs doubling: the
  # regex has to end up with \\. (an escape pair) and [^"\\], not \. and [^"\].
  pat="^[[:space:]]*$2[[:space:]]*=[[:space:]]*\"((\\\\.|[^\"\\\\])*)\"[[:space:]]*(#.*)?\$"
  [[ $raw =~ $pat ]] || { printf '%s' "$MALFORMED_SCALAR"; return; }
  reject_escapes "${BASH_REMATCH[1]//\\\"/\"}"
}

# Leading/trailing blank lines are an artifact of each format's delimiters.
trim() {
  awk 'NF {p=1} p' | awk '{lines[NR]=$0} END {last=NR; while (last>0 && lines[last]=="") last--; for (i=1;i<=last;i++) print lines[i]}'
}

# One link, given explicitly rather than read from the table, so the failure
# branches can be exercised against fixtures instead of only ever running on an
# intact checkout. Prints the diagnosis; returns 1 if the link is not healthy.
check_link() {
  local link="$1" want="$2" kind="$3"
  if [ ! -e "$link" ] && [ ! -L "$link" ]; then
    echo "MISSING: ${link} does not exist — it must be a symlink to ${want}" >&2
    return 1
  fi
  if [ ! -L "$link" ]; then
    echo "NOT A SYMLINK: ${link} is a regular file; it must be a symlink to ${want}" >&2
    # Not a copy-paste one-liner on purpose: the file may hold edits that never
    # reached the canonical copy, and a chained rm would take them with it.
    echo "  check first whether it carries anything the canonical file lacks:" >&2
    echo "    diff $(dirname "$link")/${want} ${link}" >&2
    echo "  then, once nothing is left to save, replace it:" >&2
    echo "    rm ${link}" >&2
    echo "    ln -s ${want} ${link}" >&2
    return 1
  fi
  local got
  got="$(readlink "$link")"
  if [ "$got" != "$want" ]; then
    echo "WRONG TARGET: ${link} points at ${got}, expected ${want}" >&2
    return 1
  fi
  # -e follows the link, so this is the dangling case: the text is still right
  # but the sibling it names has been renamed or deleted out from under it, and
  # every harness reading through the link now gets nothing.
  if [ ! -e "$link" ]; then
    echo "DANGLING: ${link} -> ${want}, but that target does not exist" >&2
    return 1
  fi
  if { [ "$kind" = "dir" ] && [ ! -d "$link" ]; } || { [ "$kind" = "file" ] && [ ! -f "$link" ]; }; then
    echo "WRONG KIND: ${link} -> ${want} resolves, but the target is not a ${kind}" >&2
    return 1
  fi
  echo "ok: ${link} -> ${want}"
}

main() {
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
      if [ "$md_value" = "$BLOCK_SCALAR" ]; then
        echo "UNREADABLE: ${md} writes ${field} as a YAML block scalar (> or |)" >&2
        echo "  this check only reads single-line values — put it on one line" >&2
        status=1
      elif [ "$md_value" = "$MALFORMED_SCALAR" ]; then
        echo "MALFORMED: ${md} ${field} is not a scalar this check accepts" >&2
        echo "  expected 'key: value', or a quoted value optionally followed by a # comment" >&2
        status=1
      elif [ "$toml_value" = "$MALFORMED_SCALAR" ]; then
        echo "MALFORMED: ${toml} ${field} is not a scalar this check accepts" >&2
        echo "  expected 'key = \"value\"', optionally followed by a # comment" >&2
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
  # link:target:kind — kind is what the target must still BE. A path that exists
  # but changed shape (agent-memory becoming a file, CLAUDE.md becoming a
  # directory) is unusable to every consumer while passing a bare existence test.
  declare -a EXPECTED_LINKS=(
    "AGENTS.md:CLAUDE.md:file"
    "apps/ios/AGENTS.md:CLAUDE.md:file"
    "apps/web/AGENTS.md:CLAUDE.md:file"
    ".agents/skills/advisor/SKILL.md:../../../.claude/skills/advisor/SKILL.md:file"
    "apps/web/.claude/agent-memory:../../../.claude/agent-memory:dir"
  )

  for entry in "${EXPECTED_LINKS[@]}"; do
    IFS=: read -r link want kind <<< "$entry"
    check_link "$link" "$want" "$kind" || status=1
  done

  # The table cannot catch a link nobody added to it. Everything git tracks as
  # a symlink in the mirrored namespaces has to appear above, or a new mirror
  # ships unguarded and can be retargeted with the gate still green. This scan
  # only reports OMISSIONS — it is not a substitute for the table, which is
  # what still catches a link already committed as a regular file.
  while IFS= read -r tracked; do
    [ -n "$tracked" ] || continue
    case " ${EXPECTED_LINKS[*]} " in
      *" ${tracked}:"*) ;;
      *)
        echo "UNTRACKED LINK: ${tracked} is a symlink but is not in EXPECTED_LINKS" >&2
        echo "  add it as ${tracked}:$(readlink "$tracked"):file|dir so it is checked" >&2
        status=1
        ;;
    esac
  done < <(git ls-files -s -- 'AGENTS.md' 'CLAUDE.md' '.agents' '.claude' 'apps/*/AGENTS.md' 'apps/*/CLAUDE.md' 'apps/*/.claude' 2>/dev/null \
    | awk '$1 == "120000" {print $4}')

  return $status
}

# Sourced by scripts/check-agent-config-parity.test.sh for the extractors alone.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
