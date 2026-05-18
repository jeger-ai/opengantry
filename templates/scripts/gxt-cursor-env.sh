#!/usr/bin/env bash
# Load GXT Worker Runtime Contract into the current shell (Cursor terminal / manual runs).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ]; then
  echo "gxt-cursor-env: not inside a git repository" >&2
  exit 1
fi
cd "$ROOT"

MISSION="${1:-${GAPMAN_MISSION:-${GXT_MISSION_FILE:-}}}"
if [ -z "$MISSION" ] && [ -f ".gitagent/missions/ACTIVE_MISSION.md" ]; then
  MISSION=".gitagent/missions/ACTIVE_MISSION.md"
fi
if [ -z "$MISSION" ]; then
  cat >&2 <<'EOF'
gxt-cursor-env: no mission file resolved.
  source scripts/gxt-cursor-env.sh .gitagent/missions/<file>.yaml
  export GAPMAN_MISSION=.gitagent/missions/<file>.yaml
EOF
  exit 1
fi

if command -v gapman >/dev/null 2>&1; then
  eval "$(gapman runtime env --mission "$MISSION")"
elif [ -f "dist/cli/index.js" ]; then
  eval "$(node dist/cli/index.js runtime env --mission "$MISSION")"
else
  echo "gxt-cursor-env: gapman not found (npm ci && npm run build)" >&2
  exit 1
fi

printf 'GXT runtime loaded: mission=%s skill=%s\n' "$GXT_MISSION_FILE" "${GXT_SKILL_KEY:-unknown}"
