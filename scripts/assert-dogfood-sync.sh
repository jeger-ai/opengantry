#!/usr/bin/env bash
# Assert templates/scripts dogfood copies match generated scripts/ (post gen-dogfood).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "assert-dogfood-sync: not inside a git repository" >&2
  exit 1
}
cd "$ROOT"

node scripts/gen-dogfood.mjs

mismatch=0
while IFS= read -r -d '' rel; do
  src="templates/scripts/${rel}"
  dst="scripts/${rel}"
  if [[ ! -f "$dst" ]] || ! cmp -s "$src" "$dst"; then
    echo "assert-dogfood-sync: out of sync: scripts/${rel}" >&2
    mismatch=1
  fi
done < <(find templates/scripts -type f -printf '%P\0')

if [[ "$mismatch" -ne 0 ]]; then
  echo "assert-dogfood-sync: run npm run gen:dogfood and commit scripts/ copies" >&2
  exit 1
fi

echo "assert-dogfood-sync: scripts/ matches templates/scripts/"
