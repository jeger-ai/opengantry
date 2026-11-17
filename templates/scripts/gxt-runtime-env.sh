#!/bin/bash
# Load GXT Executor Runtime Contract into the current shell (any IDE terminal / manual runs). Bash only: source it from
# bash or run it with bash; zsh and sh are refused (the resolver block below uses bash arrays and BASH_REMATCH).
if [ -z "${BASH_VERSION:-}" ]; then
  echo "gxt-runtime-env: requires bash (source it from bash, or run: bash scripts/gxt-runtime-env.sh)" >&2
  return 1 2>/dev/null || exit 1
fi
# Strict mode only when run as a script. Sourced, the caller's shell options stay as they were: set -e leaking into an
# interactive shell would close it on the first refusal below (PR #369 review round). Every failure is handled here.
[[ "${BASH_SOURCE[0]}" != "${0}" ]] || set -euo pipefail

# >>> gantry-pinned-resolver (MSN-0381, MSN-0385): byte-identical in the hook shims, the launchers and their templates
# (src/cli/tests/authority-launchers.test.ts). Run an installed gantry, never this checkout's code. _gxt_pinned_gantry
# takes the first gantry on PATH outside the checkout that reports the major .gitagent/foreman/SUBSTRATE.version.json
# pins and at least that version (a prerelease only when it is exactly the pin). Sets _gxt_gantry to the path found, not
# the resolved file (version managers dispatch on argv[0]); otherwise sets _gxt_refusal and returns 1. Bash 3.2
# compatible (macOS), safe under set -eu.
# Line 1 of every file that carries this block is #!/bin/bash, never #!/usr/bin/env bash: env would look bash up on the
# caller's PATH (npm run and direnv put <checkout>/node_modules/.bin first) before this block can sanitize it (PR #369
# review round 4). Nothing here runs another interpreter by name before _gxt_sanitize_path.
# The checkout is $top (physical) and $_gxt_ltop (the logical path the caller reached it by, $top when unset). A path is
# inside when any prefix of it, walked component by component, is inside either root lexically or physically (cd -P),
# or cannot be resolved: a directory link in the checkout pointing elsewhere does not make a path outside (PR #369
# review round 3). The agent can write everything inside.
# _gxt_sanitize_path exports a PATH of only the absolute entries outside the checkout, without any node_modules/.bin
# (npm run, direnv PATH_add): the installed bin's #!/usr/bin/env node, its git and the shell tools are looked up there,
# never in a node or git the agent planted. Callers run it first, before they ask git for $top: with $top unset, the
# nearest directory above the working directory that holds .git stands in for the checkout. _gxt_pinned_gantry runs it
# again with $top set, and refuses when no node is left.
# The caller sets _gxt_local_build_var just before this block to its own human opt-in for this checkout's dist/:
# GANTRY_HOOK_LOCAL_BUILD in the hook shims, GANTRY_MCP_LOCAL_BUILD in the launchers. _gxt_local_build reads only that
# one, so an opt-in a Cursor session inherits for the MCP server never switches the git hooks (PR #369 review round).
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
_gxt_inside() {
  [[ -n "${top:-}" ]] || return 1
  case "$1/" in "$top"/* | "${_gxt_ltop:-$top}"/*) return 0 ;; esac
  return 1
}
# 0 when the absolute path $1 is inside the checkout (see above) or a prefix of it does not resolve; 1 when outside.
_gxt_path_inside() {
  local rest="${1#/}" acc="" phys
  [[ "$1" == /* ]] || return 0
  [[ -n "${top:-}" ]] || return 1
  while :; do
    acc="$acc/${rest%%/*}"
    _gxt_inside "$acc" && return 0
    phys="$(cd -P "$acc" 2>/dev/null && pwd -P)" || return 0
    _gxt_inside "$phys" && return 0
    [[ "$rest" == */* ]] || return 1
    rest="${rest#*/}"
  done
}
# 0 when the file $1 is reached within 16 hops and every link on the way, and the file itself, lies in a directory
# outside the checkout: each hop's own path is walked before its link is followed. A chain that exhausts the hops fails.
_gxt_outside_file() {
  local bin="$1" hop dir parent link
  for ((hop = 0; hop < 16; hop++)); do
    dir="$(dirname "$bin")"
    if _gxt_path_inside "$dir"; then return 1; fi
    if [[ ! -L "$bin" ]]; then [[ -f "$bin" ]]; return; fi
    parent="$(cd -P "$dir" 2>/dev/null && pwd -P)" || return 1
    link="$(readlink "$bin")" || return 1
    [[ "$link" == /* ]] || link="$parent/$link"
    bin="$link"
  done
  return 1
}
_gxt_sanitize_path() {
  local entry out="" top="${top:-}" d
  local -a entries=()
  if [[ -z "$top" ]]; then
    d="$(pwd -P)"
    while [[ -n "$d" && ! -e "$d/.git" ]]; do d="${d%/*}"; done
    top="$d"
  fi
  IFS=: read -r -a entries <<< "${PATH:-}" || true
  for entry in ${entries[@]+"${entries[@]}"}; do
    [[ "$entry" == /* ]] || continue
    case "$entry/" in */node_modules/.bin/*) continue ;; esac
    if _gxt_path_inside "$entry"; then continue; fi
    out="${out:+$out:}$entry"
  done
  PATH="$out"
  export PATH
}
_gxt_local_build() { [[ "${!_gxt_local_build_var:-}" == 1 ]]; }
_gxt_pinned_gantry() {
  local pinfile=.gitagent/foreman/SUBSTRATE.version.json pin dir node ver
  local -a dirs=()
  _gxt_gantry="" _gxt_refusal=""
  _gxt_sanitize_path
  node="$(type -P node 2>/dev/null || true)"
  if [[ -z "$node" ]] || ! _gxt_outside_file "$node"; then
    _gxt_refusal="refused: no node on PATH outside this checkout (entries in the checkout, relative ones and node_modules/.bin are dropped, so a node planted there never runs gantry); install Node.js outside the checkout"
    return 1
  fi
  pin="$(sed -n 's/.*"opengantry_version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$top/$pinfile" 2>/dev/null | head -n 1 || true)"
  if [[ -z "$pin" ]]; then
    _gxt_refusal="refused: no opengantry_version in $pinfile, so no gantry version is pinned"
    return 1
  fi
  IFS=: read -r -a dirs <<< "$PATH" || true
  for dir in ${dirs[@]+"${dirs[@]}"}; do
    [[ -f "$dir/gantry" && -x "$dir/gantry" ]] || continue
    _gxt_outside_file "$dir/gantry" || continue
    ver="$("$dir/gantry" --version 2>/dev/null | head -n 1 || true)"
    ver="${ver//[[:space:]]/}"
    if ! _gxt_satisfies "$ver" "$pin"; then
      _gxt_refusal="refused: $dir/gantry reports version '$ver', which does not satisfy $pin pinned in $pinfile (same major, at least the pin); install: npm install -g @jeger-ai/opengantry@$pin"
      return 1
    fi
    _gxt_gantry="$dir/gantry"
    return 0
  done
  _gxt_refusal="no installed gantry outside this checkout on PATH; install the pinned version: npm install -g @jeger-ai/opengantry@$pin. Developing OpenGantry itself: $_gxt_local_build_var=1 (docs/DEVELOPMENT.md)"
  return 1
}
# <<< gantry-pinned-resolver
# Sourced, this script leaves the caller only the GANTRY_* exports `gantry runtime env` prints (PR #369 review round 3):
# the work runs in _gxt_runtime_main with local variables (top, PATH, the resolver's results), _gxt_runtime_load puts
# the caller's working directory back, and every function defined here is removed before the source returns.
_gxt_runtime_main() {
  local ROOT MISSION="${1:-}" RUNTIME_SH top _gxt_ltop _gxt_gantry _gxt_refusal PATH="${PATH:-}" toplevel
  local _gxt_local_build_var=GANTRY_MCP_LOCAL_BUILD
  local -a GANTRY=()
  # The checkout is where this script lives (scripts/..), never the git repository around the working directory: a
  # repository the agent made inside the checkout (sub/deep with git init and a copied pin) would otherwise be $top,
  # and a gantry under the real checkout would count as outside (PR #369 review round 4). Known before PATH is
  # sanitized, so the sanitizer filters the real checkout. Parameter expansion, not dirname; a leading ./ so CDPATH is
  # not consulted.
  ROOT="${BASH_SOURCE[0]}"
  case "$ROOT" in */*) ROOT="${ROOT%/*}" ;; *) ROOT=. ;; esac
  case "$ROOT" in /*) ;; *) ROOT="./$ROOT" ;; esac
  if ! cd -- "$ROOT/.."; then
    echo "gxt-runtime-env: cannot cd to $ROOT/.." >&2
    return 1
  fi
  _gxt_ltop="$PWD"
  top="$(pwd -P)"
  ROOT="$top"
  _gxt_sanitize_path
  # git only confirms that root; it never chooses it. A disagreement refuses.
  toplevel="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -z "$toplevel" ]; then
    echo "gxt-runtime-env: $ROOT is not a git checkout" >&2
    return 1
  fi
  toplevel="$(cd -- "$toplevel" 2>/dev/null && pwd -P || true)"
  if [ "$toplevel" != "$top" ]; then
    echo "gxt-runtime-env: refused: git reports the checkout root '$toplevel', but this script lives in $top" >&2
    return 1
  fi
  # An installed gantry that satisfies the pin, never this checkout's dist/ unless a human set GANTRY_MCP_LOCAL_BUILD=1
  # (MSN-0385).
  if _gxt_local_build; then
    if [ ! -f "dist/cli/index.js" ]; then
      echo "gxt-runtime-env: $_gxt_local_build_var=1 but dist/cli/index.js is missing; run: npm run build" >&2
      return 1
    fi
    GANTRY=(node dist/cli/index.js)
  elif _gxt_pinned_gantry; then
    GANTRY=("$_gxt_gantry")
  else
    echo "gxt-runtime-env: $_gxt_refusal" >&2
    return 1
  fi
  # Without an argument, gantry resolves the pinned mission (gantry mission pin <file>; GANTRY_MISSION also works).
  if ! RUNTIME_SH="$("${GANTRY[@]}" runtime env ${MISSION:+--mission "$MISSION"})"; then
    cat >&2 <<'HINT'
gxt-runtime-env: no mission file resolved.
  gantry mission pin .gitagent/missions/<file>.yaml
  source scripts/gxt-runtime-env.sh .gitagent/missions/<file>.yaml
  export GANTRY_MISSION=.gitagent/missions/<file>.yaml
HINT
    return 1
  fi
  eval "$RUNTIME_SH"
  printf 'GXT runtime loaded: mission=%s skill=%s\n' "$GANTRY_MISSION_FILE" "${GANTRY_SKILL_KEY:-unknown}"
}
_gxt_runtime_load() {
  local caller="$PWD" OLDPWD="${OLDPWD:-}" rc=0
  _gxt_runtime_main "$@" || rc=$?
  builtin cd -- "$caller" 2>/dev/null || true
  unset -f _gxt_satisfies _gxt_inside _gxt_path_inside _gxt_outside_file _gxt_sanitize_path _gxt_local_build \
    _gxt_pinned_gantry _gxt_runtime_main _gxt_runtime_load
  return "$rc"
}
_gxt_runtime_load "$@"
