#!/usr/bin/env bash
# Time-to-Scaffold benchmark: delegates to public examples/benchmark-agent harness.
# Prints legacy v1 JSON timings to stdout. Requires built gapman (npm run build).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f dist/cli/index.js ]]; then
  echo "benchmark-scaffold: run npm run build first" >&2
  exit 1
fi

exec node "$ROOT/examples/benchmark-agent/run-benchmark.mjs" --timings-only
