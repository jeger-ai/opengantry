#!/usr/bin/env bash
# Cursor sessionStart — inject GXT mission scope + runtime env for OpenGantry dogfood.
set -euo pipefail

ROOT="${CURSOR_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo "")}}"
if [ -z "$ROOT" ]; then
  exit 0
fi
cd "$ROOT"
top="$(pwd -P)"
_gxt_local_build_var=GANTRY_MCP_LOCAL_BUILD
# >>> gantry-pinned-resolver (MSN-0381, MSN-0385): byte-identical in the hook shims, the launchers and their templates
# (src/cli/tests/authority-launchers.test.ts). Run an installed gantry, never this checkout's code. _gxt_pinned_gantry
# takes the first gantry on PATH outside the checkout $top (physical) that reports the major
# .gitagent/foreman/SUBSTRATE.version.json pins and at least that version (a prerelease only when it is exactly the
# pin). A gantry whose link, any link it passes through, or its target lives in the checkout (dist/, node_modules/.bin)
# is skipped: the agent can write those. Sets _gxt_gantry to the path found, not the resolved file (version managers
# dispatch on argv[0]); otherwise sets _gxt_refusal and returns 1. Bash 3.2 compatible (macOS), safe under set -eu.
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
_gxt_inside() { case "$1/" in "$top"/*) return 0 ;; esac; return 1; }
_gxt_local_build() { [[ "${!_gxt_local_build_var:-}" == 1 ]]; }
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
  _gxt_refusal="no installed gantry outside this checkout on PATH; install the pinned version: npm install -g @jeger-ai/opengantry@$pin. Developing OpenGantry itself: $_gxt_local_build_var=1 (docs/DEVELOPMENT.md)"
  return 1
}
# <<< gantry-pinned-resolver

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
  node -e '
    process.stdout.write(JSON.stringify({ additional_context: "GXT: " + process.argv[1] }));
  ' "$reason"
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
