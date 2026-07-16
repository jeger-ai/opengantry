#!/usr/bin/env bash
# Core GXT + gantry stack without PR mission verify (avoids verify gate recursion).
# Used as MSN-0020 gate_command; full stack: ./scripts/dev-validate.sh
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "dev-validate-core: not inside a git repository" >&2
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

echo "dev-validate-core: build"
npm run build

if [[ -f dist/cli/index.js ]]; then
  GANTRY=(node dist/cli/index.js)
elif command -v gantry >/dev/null 2>&1; then
  GANTRY=(gantry)
else
  echo "dev-validate-core: gantry unavailable after build (missing dist/cli/index.js)" >&2
  exit 1
fi

echo "dev-validate-core: assert documentation deterministic metrics"
./scripts/assert-docs-deterministic.sh

echo "dev-validate-core: assert no stale CLI naming drift (implementation paths)"
./scripts/assert-no-stale-cli-naming.sh

echo "dev-validate-core: gantry check (Rule 4.4)"
"${GANTRY[@]}" check

echo "dev-validate-core: Foreman MANIFEST (Node parity)"
./scripts/validate-gxt.sh manifest

echo "dev-validate-core: upgrade-tmp staging guard"
./scripts/validate-gxt.sh upgrade-tmp

echo "dev-validate-core: unit tests"
node --test "dist/cli/tests/**/*.test.js"

echo "dev-validate-core: MCP dogfood flow"
./scripts/validate-mcp-dogfood.sh

echo "dev-validate-core: gantry doctor"
"${GANTRY[@]}" doctor

echo "dev-validate-core: changed-code quality (${BASE_REF}..${HEAD_REF})"
./scripts/check-changed-code.sh "${BASE_REF}" "${HEAD_REF}"

if git rev-parse --verify "${BASE_REF}^{commit}" >/dev/null 2>&1; then
  echo "dev-validate-core: path-scoped MSN subjects (${BASE_REF}..${HEAD_REF})"
  ./scripts/validate-gxt.sh msn "${BASE_REF}" "${HEAD_REF}"
fi

echo "dev-validate-core OK — stack: check, manifest, tests, doctor, changed-code, MSN"
