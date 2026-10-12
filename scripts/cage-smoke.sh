#!/usr/bin/env bash
# Cross-platform cage regression smoke (unit tests + built CLI). Used by .github/workflows/cage-smoke.yml.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "cage-smoke: not inside a git repository" >&2
  exit 1
}
cd "$ROOT"

echo "cage-smoke: build"
npm run build

echo "cage-smoke: cage unit tests"
node --import ./dist/cli/tests/test-tmpdir-setup.js --test \
  dist/cli/tests/cage.test.js \
  dist/cli/tests/cage-watch.test.js \
  dist/cli/tests/cage-suggest.test.js
