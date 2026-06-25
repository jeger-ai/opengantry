#!/usr/bin/env bash
# Load GXT Worker Runtime Contract into the current shell (any IDE terminal / manual runs).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ]; then
  echo "gxt-runtime-env: not inside a git repository" >&2
  exit 1
fi
cd "$ROOT"

MISSION=""
if ! MISSION="$(scripts/gxt-resolve-mission.sh "${1:-}" 2>/dev/null)"; then
  cat >&2 <<'EOF'
gxt-runtime-env: no mission file resolved.
  scripts/gxt-pin-mission.sh .gitagent/missions/<file>.yaml
  source scripts/gxt-runtime-env.sh .gitagent/missions/<file>.yaml
  export GANTRY_MISSION=.gitagent/missions/<file>.yaml
EOF
  exit 1
fi

if command -v gantry >/dev/null 2>&1; then
  eval "$(gantry runtime env --mission "$MISSION")"
elif [ -f "dist/cli/index.js" ]; then
  eval "$(node dist/cli/index.js runtime env --mission "$MISSION")"
else
  echo "gxt-runtime-env: gantry not found (npm ci && npm run build)" >&2
  exit 1
fi

printf 'GXT runtime loaded: mission=%s skill=%s\n' "$GXT_MISSION_FILE" "${GXT_SKILL_KEY:-unknown}"
