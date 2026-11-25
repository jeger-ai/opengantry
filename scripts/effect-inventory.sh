#!/usr/bin/env bash
# Inventory for the Effect migration (issue #400, ADR-0064): counts of the patterns each phase moves or removes.
# Production = packages/*/src and src/cli without tests. A report: exits 0, or 1 outside this repository.
# Usage: bash scripts/effect-inventory.sh
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || ROOT=""
if [[ -z "$ROOT" || ! -d "$ROOT/packages/core/src" || ! -d "$ROOT/src/cli" ]]; then
  echo "effect-inventory: run inside the OpenGantry repository (no packages/core/src and src/cli found)" >&2
  exit 1
fi
cd "$ROOT"

files() { grep -rl --include=*.ts -E "$1" packages/*/src src/cli | grep -v /tests/ || true; }
hits()  { grep -rn --include=*.ts -E "$1" packages/*/src src/cli | grep -v /tests/ | grep -v '^\S*:[0-9]*:import' || true; }
row()   { printf '%-30s calls=%-4s files=%s\n' "$1" "$(hits "$2" | wc -l)" "$(files "$2" | wc -l)"; }
# Files that import a specifier matching $2, by from, side-effect import, import() or require().
importers() { printf '%-30s files=%s\n' "$1" "$(files "\\b(from|import|require)\\s*\\(?\\s*[\"']$2[\"']" | wc -l)"; }

row "sync spawn calls"    '\b(spawnSync|execSync|execFileSync)\('
row "async spawn calls"   '\b(spawn|execFile|fork)\('
row "sync fs read/write"  '\b(readFileSync|writeFileSync)\('
row "git helper calls"    '\bgit(Run|RunBytes|Output|BlobAt)\('
row "zod importers"       'from "zod(/mini)?"'
row "commander importers" 'from "commander"'
row "Error subclasses"    'class \w+ extends \w*Error\b'
row "Date.now/setTimeout" '\b(Date\.now|setTimeout)\('
importers "effect importers"               "effect(/[^\"']*)?"
importers "platform-node-shared importers" "@effect/platform-node-shared(/[^\"']*)?"
importers "run-bridge callers"             "[^\"']*/run-bridge\\.js"
echo "zod importers by package:"
files 'from "zod(/mini)?"' | cut -d/ -f1-2 | sort | uniq -c
