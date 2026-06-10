#!/usr/bin/env bash
# Apply refined GitHub issue bodies from docs/github-issues/bodies/.
# Requires: gh CLI with issues:write on jeger-ai/opengantry
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BODIES_DIR="$ROOT/docs/github-issues/bodies"

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI not found" >&2
  exit 1
fi

if [[ ! -d "$BODIES_DIR" ]]; then
  echo "error: missing $BODIES_DIR" >&2
  exit 1
fi

resolve_issues() {
  if (($# > 0)); then
    printf '%s\n' "$@"
  else
    find "$BODIES_DIR" -maxdepth 1 -name '*.md' -printf '%f\n' | sed 's/\.md$//' | sort -n
  fi
}

issues=()
while IFS= read -r line; do
  issues+=("$line")
done < <(resolve_issues "$@")

if ((${#issues[@]} == 0)); then
  echo "error: no issue bodies found" >&2
  exit 1
fi

for num in "${issues[@]}"; do
  # Accept "8" or "008"
  padded=$(printf '%03d' "$((10#$num))")
  body_file="$BODIES_DIR/${padded}.md"
  if [[ ! -f "$body_file" ]]; then
    body_file="$BODIES_DIR/${num}.md"
  fi
  if [[ ! -f "$body_file" ]]; then
    echo "error: no body file for issue #$num (tried ${padded}.md)" >&2
    exit 1
  fi

  issue_num=$((10#$num))
  if [[ -n "${DRY_RUN:-}" ]]; then
    echo "DRY_RUN: would update issue #$issue_num from $body_file"
    continue
  fi

  echo "Updating issue #$issue_num ..."
  gh issue edit "$issue_num" --body-file "$body_file"
done

echo "Done (${#issues[@]} issue(s))."
