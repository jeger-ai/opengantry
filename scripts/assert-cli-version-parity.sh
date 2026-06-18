#!/usr/bin/env bash
# Assert compiled CLI --version matches package.json semver (release gate guard).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "assert-cli-version-parity: not inside a git repository" >&2
  exit 1
}
cd "$ROOT"

PKG_VERSION="$(node -p "require('./package.json').version")"

if [[ ! -f dist/cli/index.js ]]; then
  echo "assert-cli-version-parity: dist/cli/index.js missing — run npm run build" >&2
  exit 1
fi

CLI_VERSION="$(node dist/cli/index.js --version 2>/dev/null | tr -d '[:space:]')"

if [[ "$CLI_VERSION" != "$PKG_VERSION" ]]; then
  echo "assert-cli-version-parity: mismatch — package.json=${PKG_VERSION} cli=${CLI_VERSION}" >&2
  exit 1
fi

GEN_FILE="src/cli/lib/version.gen.ts"
if [[ -f "$GEN_FILE" ]]; then
  if ! grep -q "CLI_VERSION = \"${PKG_VERSION}\"" "$GEN_FILE"; then
    echo "assert-cli-version-parity: ${GEN_FILE} CLI_VERSION != ${PKG_VERSION}" >&2
    exit 1
  fi
fi

COMPAT="templates/integrations/compatibility.json"
if [[ -f "$COMPAT" ]]; then
  COMPAT_VERSION="$(node -p "require('./${COMPAT}').opengantry_version")"
  if [[ "$COMPAT_VERSION" != "$PKG_VERSION" ]]; then
    echo "assert-cli-version-parity: compatibility.json opengantry_version=${COMPAT_VERSION} != ${PKG_VERSION}" >&2
    exit 1
  fi
fi

echo "assert-cli-version-parity OK — package.json, CLI, version.gen.ts, compatibility.json at ${PKG_VERSION}"
