#!/usr/bin/env bash
# Emits the SessionStart hook payload: the part of ARCHITECTURE.md above the
# hook:end marker, wrapped as the JSON the hook protocol expects.
#
# This lives in a script rather than inline in .claude/settings.json because
# `awk ... | jq ...` exits with jq's status: awk failing on a missing file
# would still produce valid JSON with an empty context, and every session would
# silently start with no architecture map. Both failure modes below are loud on
# purpose — a broken hook should be visible, not quietly degrade.
set -euo pipefail

cd "$(dirname "$0")/.."

readonly SOURCE="ARCHITECTURE.md"
readonly MARKER='<!-- hook:end -->'

if [ ! -f "$SOURCE" ]; then
  echo "session-context: $SOURCE not found" >&2
  exit 1
fi

# Without the marker awk would print the whole file, undoing the token saving
# this split exists for — and nothing downstream would notice.
if ! grep -qF -- "$MARKER" "$SOURCE"; then
  echo "session-context: $SOURCE has no '$MARKER' marker; refusing to inject the whole file" >&2
  exit 1
fi

awk -v marker="$MARKER" 'index($0, marker) {exit} {print}' "$SOURCE" \
  | jq -Rs '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: .}}'
