#!/usr/bin/env bash
# Dual-mode Cursor MCP launcher: local dist/cli (specimen) or PATH gantry (adopter).
# stdin/stdout/stderr must pass through unbuffered — do not echo on any stream.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if [[ -f dist/cli/index.js ]]; then
  exec node dist/cli/index.js mcp serve "$@"
fi
exec gantry mcp serve "$@"
