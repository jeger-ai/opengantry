#!/usr/bin/env bash
# Shell-wrapper bootstrap for CLI-first agents (Claude Code, Codex CLI, OpenCode).
# These tools do not execute project hook directories — inject GXT runtime via this wrapper.
set -euo pipefail

AGENT="${1:-}"
if [ -z "$AGENT" ]; then
  cat >&2 <<'EOF'
Usage: scripts/gxt-shell-agent.sh <claude|codex|opencode> [mission.yaml] [--] [agent args...]

Loads GXT mission runtime env, then execs the agent CLI. Prefer over phantom hook files.
EOF
  exit 2
fi
shift

MISSION_ARG=""
if [ $# -gt 0 ] && [ "$1" != "--" ]; then
  case "$1" in
    *.yaml|*.yml|*.md)
      MISSION_ARG="$1"
      shift
      ;;
  esac
fi

if [ "${1:-}" = "--" ]; then
  shift
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ]; then
  echo "gxt-shell-agent: not inside a git repository" >&2
  exit 1
fi
cd "$ROOT"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/gxt-runtime-env.sh
source "$SCRIPT_DIR/gxt-runtime-env.sh" ${MISSION_ARG:+"$MISSION_ARG"}

case "$AGENT" in
  claude)
    DEFAULT_CMD=(claude)
    ;;
  codex)
    DEFAULT_CMD=(codex)
    ;;
  opencode)
    DEFAULT_CMD=(opencode)
    ;;
  *)
    echo "gxt-shell-agent: unsupported agent '$AGENT' (use claude, codex, or opencode)" >&2
    exit 2
    ;;
esac

if [ $# -eq 0 ]; then
  exec "${DEFAULT_CMD[@]}"
else
  exec "$@"
fi
