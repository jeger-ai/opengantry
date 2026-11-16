#!/usr/bin/env bash
# Cursor MCP launcher: an installed gantry that satisfies the pin (the resolver block below, MSN-0385), never this
# checkout's dist/ unless a human sets GANTRY_HOOK_LOCAL_BUILD=1 (developing OpenGantry itself).
# stdout carries the MCP protocol: nothing is printed there; a refusal goes to stderr.
set -euo pipefail

top="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$top"
# >>> gantry-pinned-resolver (MSN-0381, MSN-0385): byte-identical in the hook shims, the launchers and their templates
# (src/cli/tests/authority-launchers.test.ts). Run an installed gantry, never this checkout's code. _gxt_pinned_gantry
# takes the first gantry on PATH outside the checkout $top (physical) that reports the major
# .gitagent/foreman/SUBSTRATE.version.json pins and at least that version (a prerelease only when it is exactly the
# pin). A gantry whose link, any link it passes through, or its target lives in the checkout (dist/, node_modules/.bin)
# is skipped: the agent can write those. Sets _gxt_gantry to the path found, not the resolved file (version managers
# dispatch on argv[0]); otherwise sets _gxt_refusal and returns 1. Bash 3.2 compatible (macOS), safe under set -eu.
# The rule of satisfiesPin (substrate-version.ts): same major, at least the pin, a prerelease only when it is exactly the pin.
_gxt_satisfies() {
  local semver='^([0-9]{1,9})\.([0-9]{1,9})\.([0-9]{1,9})(-[0-9A-Za-z.-]+)?$'
  [[ "$1" =~ $semver ]] || return 1
  local a1=$((10#${BASH_REMATCH[1]})) a2=$((10#${BASH_REMATCH[2]})) a3=$((10#${BASH_REMATCH[3]})) ap="${BASH_REMATCH[4]}"
  [[ "$2" =~ $semver ]] || return 1
  local b1=$((10#${BASH_REMATCH[1]})) b2=$((10#${BASH_REMATCH[2]})) b3=$((10#${BASH_REMATCH[3]})) bp="${BASH_REMATCH[4]}"
  ((a1 == b1)) || return 1
  [[ -z "$ap" || "$1" == "$2" ]] || return 1
  ((a2 == b2)) || { ((a2 > b2)); return; }
  ((a3 == b3)) || { ((a3 > b3)); return; }
  [[ "$1" == "$2" || (-z "$ap" && -n "$bp") ]]
}
_gxt_inside() { case "$1/" in "$top"/*) return 0 ;; esac; return 1; }
_gxt_pinned_gantry() {
  local pinfile=.gitagent/foreman/SUBSTRATE.version.json pin dir bin ok hop parent link ver
  local -a dirs=()
  _gxt_gantry="" _gxt_refusal=""
  pin="$(sed -n 's/.*"opengantry_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$top/$pinfile" 2>/dev/null | head -n 1 || true)"
  if [[ -z "$pin" ]]; then
    _gxt_refusal="refused: no opengantry_version in $pinfile, so no gantry version is pinned"
    return 1
  fi
  IFS=: read -r -a dirs <<< "$PATH" || true
  for dir in ${dirs[@]+"${dirs[@]}"}; do
    [[ "$dir" == /* && -f "$dir/gantry" && -x "$dir/gantry" ]] || continue
    # Accepted only when a non-link is reached within 16 hops and every hop's physical directory, the final file's
    # included, lies outside the checkout. A chain that exhausts the hops is skipped.
    bin="$dir/gantry" ok=0
    for ((hop = 0; hop < 16; hop++)); do
      parent="$(cd -P "$(dirname "$bin")" 2>/dev/null && pwd -P)" || break
      if _gxt_inside "$parent"; then break; fi
      if [[ ! -L "$bin" ]]; then ok=1; break; fi
      link="$(readlink "$bin")" || break
      [[ "$link" == /* ]] || link="$parent/$link"
      bin="$link"
    done
    [[ "$ok" == 1 && -f "$bin" ]] || continue
    ver="$("$dir/gantry" --version 2>/dev/null | head -n 1 || true)"
    ver="${ver//[[:space:]]/}"
    if ! _gxt_satisfies "$ver" "$pin"; then
      _gxt_refusal="refused: $dir/gantry reports version '$ver', which does not satisfy $pin pinned in $pinfile (same major, at least the pin); install: npm install -g @jeger-ai/opengantry@$pin"
      return 1
    fi
    _gxt_gantry="$dir/gantry"
    return 0
  done
  _gxt_refusal="no installed gantry outside this checkout on PATH; install the pinned version: npm install -g @jeger-ai/opengantry@$pin. Developing OpenGantry itself: GANTRY_HOOK_LOCAL_BUILD=1 (docs/DEVELOPMENT.md)"
  return 1
}
# <<< gantry-pinned-resolver
if [[ "${GANTRY_HOOK_LOCAL_BUILD:-}" == 1 ]]; then
  if [[ -f dist/cli/index.js ]]; then exec node dist/cli/index.js mcp serve "$@"; fi
  echo "mcp-launcher: GANTRY_HOOK_LOCAL_BUILD=1 but dist/cli/index.js is missing; run: npm run build" >&2
  exit 1
fi
if ! _gxt_pinned_gantry; then
  echo "mcp-launcher: $_gxt_refusal" >&2
  exit 1
fi
exec "$_gxt_gantry" mcp serve "$@"
