#!/usr/bin/env bash
# One-time git + planner stamp for target-repo live gantry::verify demos.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../target-repo" && pwd)"
cd "$ROOT"
if [[ ! -d .git ]]; then
  git init -b main
fi
git config user.email "fixture-planner@opengantry.local"
git config user.name "Fixture Planner"

# Non-planner fixture updates must not use [MSN-…] subjects (git-proof scans newest stamp).
if git diff --quiet && git diff --cached --quiet; then
  echo "target-repo: working tree clean"
else
  git add -A
  if git diff --cached --name-only | grep -q '^\.gitagent/missions/'; then
    git commit -m "[MSN-9002] planner mission stamp"
  else
    git commit -m "fixture: sync target-repo files (no MSN subject)"
  fi
fi

# Ensure newest [MSN-9002] stamp touches the mission file.
if ! git log -1 --format=%s | grep -q '^\[MSN-9002\]'; then
  git add .gitagent/missions/MSN-9002.iii-integration-demo.yaml
  if ! git diff --cached --quiet; then
    git commit -m "[MSN-9002] planner mission stamp"
  fi
fi

echo "target-repo: git-proof ready ($(git rev-parse --short HEAD))"
