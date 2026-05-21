#!/usr/bin/env bash
# Pin the active GXT mission for gxt-runtime-env.sh and Cursor sessionStart hooks.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ]; then
  echo "gxt-pin-mission: not inside a git repository" >&2
  exit 1
fi
cd "$ROOT"

if [ $# -lt 1 ]; then
  cat >&2 <<'EOF'
usage: scripts/gxt-pin-mission.sh .gitagent/missions/<file>.yaml

Writes .gitagent/missions/.active-mission (gitignored) for:
  - scripts/gxt-runtime-env.sh (no arg)
  - .cursor/hooks/gxt-session-start.sh (new Agent sessions)
EOF
  exit 1
fi

MISSION="$1"
if [ ! -f "$MISSION" ]; then
  echo "gxt-pin-mission: mission file not found: $MISSION" >&2
  exit 1
fi

mkdir -p .gitagent/missions
printf '%s\n' "$MISSION" > .gitagent/missions/.active-mission
printf 'Pinned active mission: %s\n' "$MISSION"
