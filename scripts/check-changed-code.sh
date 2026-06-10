#!/usr/bin/env bash
# Hard-fail quality gates for changed TypeScript only (complexity + import layers + file size).
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

# File line budgets (skip fully grandfathered files for line count only)
PROD_MAX=450
TEST_MAX=900
BASELINE=".gxt-quality-baseline.json"

is_grandfathered() {
  local f="$1"
  node -e "
    const fs=require('fs');
    const f=process.argv[1];
    const b=JSON.parse(fs.readFileSync('.gxt-quality-baseline.json','utf8'));
    process.exit(b.grandfathered_files.includes(f)?0:1);
  " "$f" 2>/dev/null
}

for f in "${CHANGED[@]}"; do
  [[ -f "$f" ]] || continue
  if is_grandfathered "$f"; then
    echo "  skip line budget (grandfathered): $f"
    continue
  fi
  lines="$(wc -l <"$f" | tr -d ' ')"
  if [[ "$f" == *"/tests/"* ]]; then
    max=$TEST_MAX
  else
    max=$PROD_MAX
  fi
  if [[ "$lines" -gt "$max" ]]; then
    echo "check-changed-code FAILED: $f has $lines lines (max $max for changed non-grandfathered file)" >&2
    exit 1
  fi
done

# ESLint complexity on changed files that still exist
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
  node scripts/check-import-layers.mjs "${LAYER_FILES[@]}"
fi

echo "check-changed-code OK"
