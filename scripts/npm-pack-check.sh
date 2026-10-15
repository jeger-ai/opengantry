#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# PACK_CHECK_SKIP_BUILD=1 packs dist/ as it is, to check what a publish from this working copy would ship.
if [[ "${PACK_CHECK_SKIP_BUILD:-}" != "1" ]]; then
  npm run build
fi
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

# Every compiled module must still have its source (MSN-0273): tsc never deletes outputs, so a renamed or deleted
# src/<path>.ts leaves dist/<path>.js behind, and npm publishes all of dist/.
orphans=()
while IFS= read -r entry; do
  rel="${entry#package/dist/}"
  for suffix in .d.ts.map .js.map .d.ts .js; do
    if [[ "$rel" == *"$suffix" ]]; then
      [[ -f "src/${rel%"$suffix"}.ts" ]] || orphans+=("${entry#package/}")
      break
    fi
  done
done < <(grep -E '^package/dist/.+\.(js|d\.ts)(\.map)?$' <<<"$listing" || true)
if [[ ${#orphans[@]} -gt 0 ]]; then
  echo "npm-pack-check: ${#orphans[@]} file(s) in the tarball have no source in src/ (run npm run build, which prunes them):" >&2
  printf '  %s\n' "${orphans[@]}" >&2
  exit 1
fi

echo "pack:check OK ($TARBALL)"
