#!/usr/bin/env bash
# Resolve active GXT mission path (repo-relative). Prints path on stdout; exit 1 if unset.
set -euo pipefail

ROOT="${GXT_RESOLVE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
if [ -z "$ROOT" ]; then
  exit 1
fi
cd "$ROOT"

explicit="${1:-}"
if [ -n "$explicit" ]; then
  printf '%s\n' "$explicit"
  exit 0
fi

if [ -n "${GAPMAN_MISSION:-}" ]; then
  printf '%s\n' "$GAPMAN_MISSION"
  exit 0
fi

if [ -n "${GXT_MISSION_FILE:-}" ]; then
  printf '%s\n' "$GXT_MISSION_FILE"
  exit 0
fi

if [ -f ".gitagent/missions/.active-mission" ]; then
  line=""
  IFS= read -r line < ".gitagent/missions/.active-mission" || true
  line="$(printf '%s' "$line" | tr -d '[:space:]')"
  if [ -n "$line" ]; then
    printf '%s\n' "$line"
    exit 0
  fi
fi

if [ -f ".gitagent/missions/ACTIVE_MISSION.md" ]; then
  printf '%s\n' ".gitagent/missions/ACTIVE_MISSION.md"
  exit 0
fi

if [ -f ".gitagent/missions/ACTIVE_MISSION.yaml" ]; then
  printf '%s\n' ".gitagent/missions/ACTIVE_MISSION.yaml"
  exit 0
fi

exit 1
