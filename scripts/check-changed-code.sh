#!/usr/bin/env bash
# Hard-fail quality gates for changed TypeScript only (lint, import layers, test file size).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "check-changed-code: not inside a git repository" >&2
  exit 1
}
cd "$ROOT"

BASE_REF="${1:-origin/main}"
HEAD_REF="${2:-HEAD}"

if ! git rev-parse --verify "${BASE_REF}^{commit}" >/dev/null 2>&1; then
  BASE_REF="HEAD~1"
fi
if ! git rev-parse --verify "${HEAD_REF}^{commit}" >/dev/null 2>&1; then
  HEAD_REF="HEAD"
fi

mapfile -t CHANGED < <(
  git diff --name-only --diff-filter=ACMRT "${BASE_REF}..${HEAD_REF}" -- 'src/cli/**/*.ts' 2>/dev/null || true
)

if [[ "${#CHANGED[@]}" -eq 0 ]]; then
  echo "check-changed-code: no changed src/cli TypeScript files"
  exit 0
fi

echo "check-changed-code: ${#CHANGED[@]} changed file(s) (${BASE_REF}..${HEAD_REF})"

# Per-file budgets moved to TARGET_ARCHITECTURE.yaml (ADR-0052 B4, B7): layer budgets ratchet against
# ARCH_BASELINE.json and the 800-line ceiling is a `budget` rule; `gantry arch check` (whole tree) enforces them in
# dev-validate-core.sh. Test files keep a sanity cap here because they are outside the counted layers.
TEST_MAX=900
for f in "${CHANGED[@]}"; do
  [[ -f "$f" ]] || continue
  [[ "$f" == *"/tests/"* ]] || continue
  lines="$(wc -l <"$f" | tr -d ' ')"
  if [[ "$lines" -gt "$TEST_MAX" ]]; then
    echo "check-changed-code FAILED: $f has $lines lines (max $TEST_MAX for a changed test file)" >&2
    exit 1
  fi
done
EXISTING=()
for f in "${CHANGED[@]}"; do
  [[ -f "$f" ]] && EXISTING+=("$f")
done
if [[ "${#EXISTING[@]}" -gt 0 ]]; then
  npx eslint --no-error-on-unmatched-pattern "${EXISTING[@]}"
fi

# Import layer rules (skip intentional test fixtures that deliberately violate layers)
LAYER_FILES=()
for f in "${EXISTING[@]}"; do
  [[ "$f" == *"/tests/fixtures/"* ]] && continue
  LAYER_FILES+=("$f")
done
if [[ "${#LAYER_FILES[@]}" -gt 0 ]]; then
  node dist/cli/index.js arch check "${LAYER_FILES[@]}"
fi

echo "check-changed-code OK"
