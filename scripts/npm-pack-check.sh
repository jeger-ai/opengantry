#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

npm run build
TARBALL=$(npm pack --silent)
trap 'rm -f "$TARBALL"' EXIT

listing=$(tar -tzf "$TARBALL")

for path in \
  package/dist/cli/index.js \
  package/templates/integrations/compatibility.json \
  package/LICENSE \
  package/README.md; do
  # Avoid printf|grep SIGPIPE under pipefail (false "missing" when grep exits early on match).
  if ! grep -qxF -- "$path" <<<"$listing"; then
    echo "npm-pack-check: missing $path in $TARBALL" >&2
    exit 1
  fi
done

if grep -q 'package/dist/cli/tests/' <<<"$listing"; then
  echo "npm-pack-check: unexpected test files in tarball" >&2
  exit 1
fi

echo "pack:check OK ($TARBALL)"
