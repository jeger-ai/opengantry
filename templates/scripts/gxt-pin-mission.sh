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

Prefer: gantry pin <mission>  (writes repo-relative path)
EOF
  exit 1
fi

MISSION="$1"
if command -v gantry >/dev/null 2>&1; then
  gantry pin "$MISSION"
  exit $?
fi

if [ ! -f "$MISSION" ]; then
  echo "gxt-pin-mission: mission file not found: $MISSION" >&2
  exit 1
fi

mkdir -p .gitagent/missions
# Repo-relative path (matches gantry pin / pinMissionFile; portable — no GNU realpath)
if [[ "$MISSION" = /* ]]; then
  MISSION_REL="${MISSION#"$ROOT"/}"
else
  MISSION_REL="$MISSION"
fi
printf '%s\n' "$MISSION_REL" > .gitagent/missions/.active-mission
printf 'Pinned active mission: %s\n' "$MISSION_REL"
