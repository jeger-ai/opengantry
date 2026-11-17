#!/bin/bash
# Cursor beforeShellExecution — lightweight GXT substrate guard (deterministic fallback).
# Primary legislation gate is MCP two-step draft/execute; this hook covers non-MCP shell paths.
# Contract with Cursor: the command arrives as JSON on stdin; one JSON decision goes to stdout, {"permission":"allow"}
# or {"permission":"ask","user_message":…,"agent_message":…}; the hook always exits 0.
set -euo pipefail

_gxt_local_build_var=GANTRY_MCP_LOCAL_BUILD
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
# MSN-0390: Cursor runs this hook before every shell command, so it starts on #!/bin/bash and sanitizes PATH before
# any lookup, like the launchers above. It runs no gantry: it carries the resolver block for _gxt_sanitize_path and
# _gxt_outside_file, and runs node only when node and every link to it lie outside the checkout. No tool is looked up
# before PATH is sanitized: stdin is read with the read builtin, the root is found by parameter expansion.
# The checkout is the project directory the IDE names, else where this hook lives (.cursor/hooks/../..), never the
# git repository around the working directory (as the sessionStart hook).
ROOT="${CURSOR_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-}}"
if [ -z "$ROOT" ]; then
  ROOT="${BASH_SOURCE[0]}"
  case "$ROOT" in */*) ROOT="${ROOT%/*}" ;; *) ROOT=. ;; esac
  ROOT="$ROOT/../.."
fi
case "$ROOT" in /*) ;; *) ROOT="./$ROOT" ;; esac

# A fixed decision, written without node: the reason is a constant, so nothing needs escaping.
refuse() {
  printf '{"permission":"ask","user_message":"GXT shell guard: %s, so this command was not checked. Confirm it does not touch .gitagent/foreman/ or RULES.md.","agent_message":"refused: %s; the GXT beforeShellExecution guard could not check this command."}\n' "$1" "$1"
  exit 0
}

cd -- "$ROOT" 2>/dev/null || refuse "the checkout root could not be entered"
_gxt_ltop="$PWD"
top="$(pwd -P)"
_gxt_sanitize_path
node="$(type -P node 2>/dev/null || true)"
if [[ -z "$node" ]] || ! _gxt_outside_file "$node"; then
  refuse "no node on PATH outside this checkout (entries in the checkout, relative ones and node_modules/.bin are dropped, so a node planted there never runs); install Node.js outside the checkout"
fi

input=""
IFS= read -r -d '' input || true
command="$(
  printf '%s' "$input" | "$node" -e '
    let s = "";
    process.stdin.on("data", (c) => (s += c));
    process.stdin.on("end", () => {
      try {
        const j = JSON.parse(s);
        process.stdout.write(String(j.command ?? ""));
      } catch {
        process.stdout.write("");
      }
    });
  '
)"

allow() {
  printf '%s\n' '{"permission":"allow"}'
}

ask() {
  local user_msg="$1"
  local agent_msg="$2"
  "$node" -e '
    const user = process.argv[1];
    const agent = process.argv[2];
    process.stdout.write(JSON.stringify({
      permission: "ask",
      user_message: user,
      agent_message: agent,
    }));
  ' "$user_msg" "$agent_msg"
  printf '\n'
}

if [ -z "$command" ]; then
  allow
  exit 0
fi

# Block casual shell writes to GXT law/manifest — Planner legislation required.
if printf '%s' "$command" | grep -qE '\.gitagent/foreman/|\.gitagent/planner/RULES\.md'; then
  ask \
    "Shell command touches GXT law or manifest. Confirm this is under an active Planner mission." \
    "Direct shell edits to .gitagent/foreman/ or .gitagent/planner/RULES.md require Planner legislation ([MSN-NNNN] commit). Prefer gxt_draft_legislation + gxt_execute_legislation MCP tools."
  exit 0
fi

# Fallback guard when agents bypass MCP and run legislate via raw shell.
if printf '%s' "$command" | grep -qE '(^|[[:space:]/])gantry[[:space:]]+legislate\b'; then
  ask \
    "Shell command runs gantry legislate directly. Confirm you intend to write mission law outside the MCP draft/execute gate." \
    "Prefer MCP: gxt_draft_legislation (preview) → human chat approval → gxt_execute_legislation. Shell legislate is a fallback path only."
  exit 0
fi

allow
exit 0
