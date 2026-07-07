#!/usr/bin/env bash
# Dogfood validation: MCP two-step legislation state machine (no Cursor required).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

on_err() {
  echo "validate-mcp-dogfood: failed at line ${1:-?} (exit $?)" >&2
}
trap 'on_err $LINENO' ERR

if [[ ! -f dist/cli/lib/mcp-legislation.js ]]; then
  npm run build
fi

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p "$TMP/.gitagent/foreman" "$TMP/.gitagent/missions" "$TMP/.gitagent/planner"
cp .gitagent/foreman/MANIFEST.json "$TMP/.gitagent/foreman/MANIFEST.json"
cp .gitagent/planner/MISSION.schema.yaml "$TMP/.gitagent/planner/MISSION.schema.yaml"
git -C "$TMP" init -q
git -C "$TMP" config user.email "teacher@example.com"
git -C "$TMP" config user.name "MCP Dogfood Teacher"
git -C "$TMP" add .
git -C "$TMP" commit -m "init" -q

export GANTRY_TEACHER_EMAILS="teacher@example.com"
export GXT_DOGFOOD_TMP="$TMP"

node "$ROOT/scripts/validate-mcp-dogfood.mjs"

echo "scripts/validate-mcp-dogfood.sh: passed"
