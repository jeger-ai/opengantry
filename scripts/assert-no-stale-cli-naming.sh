#!/usr/bin/env bash
# Fail when implementation paths still reference legacy gapman/GAPMAN naming outside the allowlist.
# Documentation surfaces are checked separately by assert-docs-deterministic.sh.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "assert-no-stale-cli-naming: not inside a git repository" >&2
  exit 1
}
cd "$ROOT"

if ! command -v rg >/dev/null 2>&1; then
  echo "assert-no-stale-cli-naming: ripgrep (rg) required" >&2
  exit 1
fi

CODE_PATHS=(
  src
  scripts
  .githooks
  templates/.githooks
  templates/scripts
  examples
  .gitignore
  .prettierignore
)

mapfile -t hits < <(
  rg -i 'gapman|GAPMAN' "${CODE_PATHS[@]}" \
    --glob '!node_modules/**' \
    --glob '!examples/**/package-lock.json' \
    --glob '!scripts/assert-no-stale-cli-naming.sh' \
    --glob '!scripts/assert-docs-deterministic.sh' \
    -l 2>/dev/null || true
)

if [[ ${#hits[@]} -gt 0 ]]; then
  echo "assert-no-stale-cli-naming FAILED: legacy CLI naming in implementation paths:" >&2
  printf '  %s\n' "${hits[@]}" >&2
  echo "  Fix naming to gantry/GANTRY_* or add an intentional legacy allowlist entry in scripts/assert-no-stale-cli-naming.sh" >&2
  exit 1
fi

echo "assert-no-stale-cli-naming OK"
