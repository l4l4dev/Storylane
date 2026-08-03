#!/usr/bin/env bash
# Regression cases for the metadata extractors in check-agent-config-parity.sh.
#
# Every case here came from a review finding on the same class of bug: a
# malformed or unusually-spelled field that the extractor read as a value which
# happened to equal its counterpart, so the gate printed ok on a config no
# harness could load. Hand-checking each one and throwing the harness away is
# how three rounds of the same class got through — they live here now.
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

echo "--- ${pass} passed, ${fail} failed ---"
[ "$fail" -eq 0 ]
