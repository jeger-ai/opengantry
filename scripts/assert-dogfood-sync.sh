#!/usr/bin/env bash
# Assert templates/scripts dogfood copies match generated scripts/ (post gen-dogfood).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "assert-dogfood-sync: not inside a git repository" >&2
  exit 1
}
cd "$ROOT"

node scripts/gen-dogfood.mjs

if ! git diff --exit-code -- scripts/ templates/scripts/ >/dev/null; then
  echo "assert-dogfood-sync: scripts/ or templates/scripts/ drifted after gen-dogfood" >&2
  echo "assert-dogfood-sync: run npm run gen:dogfood and commit scripts/ copies" >&2
  git diff --stat -- scripts/ templates/scripts/ >&2 || true
  exit 1
fi

echo "assert-dogfood-sync: scripts/ matches templates/scripts/"
