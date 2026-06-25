#!/usr/bin/env bash
# OpenGantry dogfood: run the full local GXT + gantry stack before push/PR.
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

./scripts/dev-validate-core.sh "${BASE_REF}" "${HEAD_REF}"

if git rev-parse --verify "${BASE_REF}^{commit}" >/dev/null 2>&1; then
  echo "dev-validate: PR mission verify (${BASE_REF}...${HEAD_REF})"
  ./scripts/verify-pr-missions.sh "${BASE_REF}" "${HEAD_REF}"
fi

echo "dev-validate OK — stack: check, manifest, tests, doctor, changed-code, MSN, mission-verify"
