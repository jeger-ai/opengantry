#!/usr/bin/env bash
# Load GXT Executor Runtime Contract into the current shell (any IDE terminal / manual runs).
set -euo pipefail

# Print the message; the caller returns (when sourced) or exits (when run) right after.
_gxt_runtime_die() {
  echo "$1" >&2
}
_gxt_runtime_sourced() {
  [[ "${BASH_SOURCE[0]}" != "${0}" ]]
}

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ]; then
  _gxt_runtime_die "gxt-runtime-env: not inside a git repository"
  _gxt_runtime_sourced && return 1 || exit 1
fi
cd "$ROOT"

MISSION="${1:-}"
if command -v gantry >/dev/null 2>&1; then
  GANTRY=(gantry)
elif [ -f "dist/cli/index.js" ]; then
  GANTRY=(node dist/cli/index.js)
else
  _gxt_runtime_die "gxt-runtime-env: gantry not found (npm ci && npm run build, or npm install -g @jeger-ai/opengantry)"
  _gxt_runtime_sourced && return 1 || exit 1
fi
# Without an argument, gantry resolves the pinned mission (gantry pin <file>; GANTRY_MISSION also works).
if ! RUNTIME_SH="$("${GANTRY[@]}" runtime env ${MISSION:+--mission "$MISSION"})"; then
  _gxt_runtime_die "$(cat <<'HINT'
gxt-runtime-env: no mission file resolved.
  gantry pin .gitagent/missions/<file>.yaml
  source scripts/gxt-runtime-env.sh .gitagent/missions/<file>.yaml
  export GANTRY_MISSION=.gitagent/missions/<file>.yaml
HINT
)"
  _gxt_runtime_sourced && return 1 || exit 1
fi
eval "$RUNTIME_SH"
printf 'GXT runtime loaded: mission=%s skill=%s\n' "$GXT_MISSION_FILE" "${GXT_SKILL_KEY:-unknown}"
