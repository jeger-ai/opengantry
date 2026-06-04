#!/usr/bin/env bash
# OpenGantry dogfood: run the full local GXT + gapman stack before push/PR.
# Usage: ./scripts/dev-validate.sh [base-ref] [head-ref]
#   base-ref defaults to origin/main (falls back to HEAD~1)
#   head-ref defaults to HEAD
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "dev-validate: not inside a git repository" >&2
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

if command -v gapman >/dev/null 2>&1; then
  GAPMAN=(gapman)
elif [[ -f dist/cli/index.js ]]; then
  GAPMAN=(node dist/cli/index.js)
else
  echo "dev-validate: build gapman first (npm run build)" >&2
  exit 1
fi

echo "dev-validate: build"
npm run build

echo "dev-validate: gapman check (Rule 4.4)"
"${GAPMAN[@]}" check

echo "dev-validate: Foreman MANIFEST (Node parity)"
./scripts/validate-gxt.sh manifest

echo "dev-validate: upgrade-tmp staging guard"
./scripts/validate-gxt.sh upgrade-tmp

echo "dev-validate: unit tests"
node --test dist/cli/tests/*.test.js

echo "dev-validate: MCP dogfood flow"
./scripts/validate-mcp-dogfood.sh

echo "dev-validate: gapman doctor"
"${GAPMAN[@]}" doctor

echo "dev-validate: changed-code quality (${BASE_REF}..${HEAD_REF})"
./scripts/check-changed-code.sh "${BASE_REF}" "${HEAD_REF}"

if git rev-parse --verify "${BASE_REF}^{commit}" >/dev/null 2>&1; then
  echo "dev-validate: path-scoped MSN subjects (${BASE_REF}..${HEAD_REF})"
  ./scripts/validate-gxt.sh msn "${BASE_REF}" "${HEAD_REF}"
  echo "dev-validate: PR mission verify (${BASE_REF}...${HEAD_REF})"
  ./scripts/verify-pr-missions.sh "${BASE_REF}" "${HEAD_REF}"
fi

echo "dev-validate OK — stack: check, manifest, tests, doctor, changed-code, MSN, mission-verify"
