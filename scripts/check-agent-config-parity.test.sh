#!/usr/bin/env bash
# Cases for check-agent-config-parity.sh's extractors and link checks.
#
# The failures worth pinning are the ones where a malformed field reads back as
# a value that happens to equal its counterpart: the gate then prints ok on a
# config no harness can load, which is worse than no gate. Each case below is
# either such a value, or a legal spelling that must NOT be mistaken for one.
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=./check-agent-config-parity.sh
source ./scripts/check-agent-config-parity.sh

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0

# $1 label, $2 expected, $3 frontmatter line
expect_md() {
  printf -- '---\n%s\ntools: Read\n---\nbody\n' "$3" > "$TMP/agent.md"
  local got
  got="$(md_field "$TMP/agent.md" "$4")"
  if [ "$got" = "$2" ]; then
    pass=$((pass + 1))
    echo "  ok   md   $1"
  else
    fail=$((fail + 1))
    echo "  FAIL md   $1: got [$got], want [$2]" >&2
  fi
}

# $1 label, $2 expected, $3 toml line
expect_toml() {
  printf -- '%s\ndeveloper_instructions = """\nbody\n"""\n' "$3" > "$TMP/agent.toml"
  local got
  got="$(toml_field "$TMP/agent.toml" "$4")"
  if [ "$got" = "$2" ]; then
    pass=$((pass + 1))
    echo "  ok   toml $1"
  else
    fail=$((fail + 1))
    echo "  FAIL toml $1: got [$got], want [$2]" >&2
  fi
}

echo "md_field:"
expect_md "plain scalar"                 "hello there"  'description: hello there'                description
expect_md "plain, surrounding space"     "hello"        'description:    hello   '                description
expect_md "double-quoted"                'a: b'         'description: "a: b"'                     description
expect_md "single-quoted"                "a: b"         "description: 'a: b'"                     description
expect_md "escaped quote inside"         'say "hi"'     'description: "say \"hi\""'               description
expect_md "quoted, trailing comment"     "hello"        'description: "hello"  # keep in sync'    description
# YAML ends a plain scalar at " #" — reading the raw line would match a TOML
# string spelled "fix #123" and call two different values equal.
expect_md "plain, inline comment"        "fix"          'description: fix #123'                   description
expect_md "hash without space is data"   "C#"           'description: C#'                         description
expect_md "unterminated double quote"    "$MALFORMED_SCALAR" 'description: "hello'                description
expect_md "unterminated single quote"    "$MALFORMED_SCALAR" "description: 'hello"                description
expect_md "junk after closing quote"     "$MALFORMED_SCALAR" 'description: "hello" junk'          description
# A plain scalar cannot contain ": " — YAML reads it as a nested mapping and
# refuses the file, so it must be quoted to be legal.
expect_md "plain with colon-space"       "$MALFORMED_SCALAR" 'description: Use when: reviewing'   description
expect_md "plain ending in colon"        "$MALFORMED_SCALAR" 'description: Use when:'             description
expect_md "quoted colon-space is fine"   "Use when: reviewing" 'description: "Use when: reviewing"' description
expect_md "folded block scalar"          "$BLOCK_SCALAR"     'description: >-'                    description
expect_md "literal block scalar"         "$BLOCK_SCALAR"     'description: |'                     description
expect_md "name reads independently"     "an-agent"     'name: an-agent'                          name

echo "toml_field:"
expect_toml "quoted"                     'a: b'         'description = "a: b"'                    description
expect_toml "escaped quote inside"       'say "hi"'     'description = "say \"hi\""'              description
expect_toml "trailing comment"           "hello"        'description = "hello"  # note'           description
expect_toml "surrounding space"          "hello"        'description   =   "hello"'               description
expect_toml "unterminated quote"         "$MALFORMED_SCALAR" 'description = "hello'               description
expect_toml "junk after closing quote"   "$MALFORMED_SCALAR" 'description = "hello" junk'         description
expect_toml "bare unquoted value"        "$MALFORMED_SCALAR" 'description = hello'                description

# The body is prose and can legitimately show `description = "..."` as an
# example; that must not stand in for a top-level field that was deleted.
printf -- 'name = "a"\ndeveloper_instructions = """\ndescription = "from the body"\n"""\n' > "$TMP/body.toml"
got="$(toml_field "$TMP/body.toml" description)"
if [ -z "$got" ]; then
  pass=$((pass + 1)); echo "  ok   toml body line is not metadata"
else
  fail=$((fail + 1)); echo "  FAIL toml body line is not metadata: got [$got]" >&2
fi

echo "check_link:"
# $1 label, $2 expected exit, $3.. setup commands run inside $TMP
expect_link() {
  local label="$1" want="$2"; shift 2
  rm -rf "$TMP/links"; mkdir -p "$TMP/links"
  ( cd "$TMP/links" && "$@" )
  local got=0
  ( cd "$TMP/links" && check_link link target "${KIND:-file}" ) >/dev/null 2>&1 || got=1
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1)); echo "  ok   $label"
  else
    fail=$((fail + 1)); echo "  FAIL $label: exit $got, want $want" >&2
  fi
}

expect_link "healthy link"        0 sh -c 'printf x > target; ln -s target link'
expect_link "missing entirely"    1 sh -c 'printf x > target'
expect_link "regular file"        1 sh -c 'printf x > target; printf x > link'
expect_link "wrong target"        1 sh -c 'printf x > target; printf x > other; ln -s other link'
expect_link "dangling"            1 sh -c 'ln -s target link'
KIND=dir expect_link "wrong kind" 1 sh -c 'printf x > target; ln -s target link'
KIND=dir expect_link "dir link ok" 0 sh -c 'mkdir target; ln -s target link'

echo "--- ${pass} passed, ${fail} failed ---"
[ "$fail" -eq 0 ]
