#!/usr/bin/env bash
# Cursor sessionStart — inject GXT mission scope + runtime env for OpenGantry dogfood.
set -euo pipefail

_gxt_local_build_var=GANTRY_MCP_LOCAL_BUILD
# >>> gantry-pinned-resolver (MSN-0381, MSN-0385): byte-identical in the hook shims, the launchers and their templates
# (src/cli/tests/authority-launchers.test.ts). Run an installed gantry, never this checkout's code. _gxt_pinned_gantry
# takes the first gantry on PATH outside the checkout that reports the major .gitagent/foreman/SUBSTRATE.version.json
# pins and at least that version (a prerelease only when it is exactly the pin). Sets _gxt_gantry to the path found, not
# the resolved file (version managers dispatch on argv[0]); otherwise sets _gxt_refusal and returns 1. Bash 3.2
# compatible (macOS), safe under set -eu.
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
_gxt_sanitize_path
ROOT="${CURSOR_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo "")}}"
if [ -z "$ROOT" ]; then
  exit 0
fi
cd "$ROOT"
_gxt_ltop="$PWD"
top="$(pwd -P)"

# gantry resolves the pinned mission itself (gantry mission pin <file>, GANTRY_MISSION, the legacy ACTIVE_MISSION files).
# An installed gantry that satisfies the pin runs, never this checkout's dist/ unless a human set
# GANTRY_MCP_LOCAL_BUILD=1 (MSN-0385). Without one, the session gets the reason instead of mission context.
RUNTIME_JSON=""
if _gxt_local_build && [[ -f dist/cli/index.js ]]; then
  RUNTIME_JSON="$(node dist/cli/index.js runtime env --json 2>/dev/null)" || RUNTIME_JSON=""
elif ! _gxt_local_build && _gxt_pinned_gantry; then
  RUNTIME_JSON="$("$_gxt_gantry" runtime env --json 2>/dev/null)" || RUNTIME_JSON=""
else
  reason="${_gxt_refusal:-$_gxt_local_build_var=1 but dist/cli/index.js is missing; run: npm run build}"
  # node from the sanitized PATH; without one, the reason is escaped here (no node in the checkout ever runs).
  node -e '
    process.stdout.write(JSON.stringify({ additional_context: "GXT: " + process.argv[1] }));
  ' "$reason" 2>/dev/null || {
    reason="${reason//\\/\\\\}"
    printf '{"additional_context":"GXT: %s"}' "${reason//\"/\\\"}"
  }
  exit 0
fi

if [ -z "$RUNTIME_JSON" ]; then
  node -e '
    process.stdout.write(JSON.stringify({
      additional_context: "No active mission pinned. Ask me to run the Mission Architect protocol (MCP: gxt_draft_legislation) or gantry legislate, then gantry mission pin <mission>.",
    }));
  '
  exit 0
fi

node -e '
const runtimeJson = process.argv[1];
const mission = "";
let payload;
try {
  payload = JSON.parse(runtimeJson);
} catch {
  process.stdout.write(JSON.stringify({ additional_context: "GXT: failed to parse runtime env" }));
  process.exit(0);
}
const tmvc = (payload.GANTRY_TMVC_ROOTS_ABSOLUTE || "").split("\n").filter(Boolean);
const forbidden = (payload.GANTRY_FORBIDDEN_ZONES || "").split("\n").filter(Boolean);
process.stdout.write(JSON.stringify({
  env: payload,
  additional_context: [
    "GXT OpenGantry active mission (auto-loaded at session start):",
    `- Mission: ${payload.GANTRY_MISSION_FILE || mission} (${payload.GANTRY_MSN_ID || "no MSN"})`,
    `- Skill: ${payload.GANTRY_SKILL_KEY || "unknown"}`,
    `- TMVC roots: ${tmvc.join(", ") || "(none)"}`,
    `- Forbidden: ${forbidden.join(", ") || "(none)"}`,
    `- Trace sink: ${payload.GANTRY_EXECUTOR_LOG || "EXECUTOR_LOG.md"}`,
    "",
    "Executor graph: edit within TMVC → append PASS quotes to EXECUTOR_LOG.md → gantry verify --mission … → npm run validate",
    "MCP tools: gxt_draft_legislation, gxt_execute_legislation, gxt_check_signature, gxt_pin_mission, gxt_runtime_env, gxt_verify (see .cursor/mcp.json).",
    "IDE Agent edits are advisory TMVC; shell substrate writes are hook-guarded. Full graph: docs/DEVELOPMENT.md",
  ].join("\n"),
}));
' "$RUNTIME_JSON"

exit 0
