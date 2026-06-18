#!/usr/bin/env bash
# Assert package.json, generated source, compatibility.json, and (optionally) compiled CLI agree.
# Invariant C: source parity is independent of dist/ and git tree cleanliness.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "assert-cli-version-parity: not inside a git repository" >&2
  exit 1
}
cd "$ROOT"

PKG_VERSION="$(node -p "require('./package.json').version")"

GEN_FILE="src/cli/lib/version.gen.ts"
if [[ ! -f "$GEN_FILE" ]]; then
  echo "assert-cli-version-parity: ${GEN_FILE} missing — run npm run gen:version" >&2
  exit 1
fi
if ! grep -q "CLI_VERSION = \"${PKG_VERSION}\"" "$GEN_FILE"; then
  echo "assert-cli-version-parity: ${GEN_FILE} CLI_VERSION != ${PKG_VERSION}" >&2
  exit 1
fi

COMPAT="templates/integrations/compatibility.json"
if [[ -f "$COMPAT" ]]; then
  COMPAT_VERSION="$(node -p "require('./${COMPAT}').opengantry_version")"
  if [[ "$COMPAT_VERSION" != "$PKG_VERSION" ]]; then
    echo "assert-cli-version-parity: compatibility.json opengantry_version=${COMPAT_VERSION} != ${PKG_VERSION}" >&2
    exit 1
  fi
fi

echo "assert-cli-version-parity: source OK — package.json, version.gen.ts, compatibility.json at ${PKG_VERSION}"

if [[ "${GXT_PARITY_SOURCE_ONLY:-}" == "1" ]]; then
  echo "assert-cli-version-parity OK (source-only mode)"
  exit 0
fi

if [[ ! -f dist/cli/index.js ]]; then
  echo "assert-cli-version-parity: dist/cli/index.js missing — run npm run build" >&2
  exit 1
fi

CLI_VERSION="$(node dist/cli/index.js --version 2>/dev/null | tr -d '[:space:]')"
if [[ "$CLI_VERSION" != "$PKG_VERSION" ]]; then
  echo "assert-cli-version-parity: runtime mismatch — package.json=${PKG_VERSION} cli=${CLI_VERSION}" >&2
  exit 1
fi

echo "assert-cli-version-parity OK — source + runtime at ${PKG_VERSION}"
