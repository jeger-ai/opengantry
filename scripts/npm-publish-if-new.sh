#!/usr/bin/env bash
# Publish the root package or one workspace to npm only when its version is not on the registry yet
# (MSN-0257). Lets npm-publish.yml re-run after a partial release without failing on the package that
# already went out: npm refuses to publish over an existing version, so the second run would otherwise
# stop before it reaches the package that is still missing.
#
#   scripts/npm-publish-if-new.sh                                   # root package
#   scripts/npm-publish-if-new.sh --workspace @jeger-ai/opengantry-cage
#   scripts/npm-publish-if-new.sh --dry-run [--workspace <name>]    # npm publish --dry-run, no provenance
#
# `npm view <name>@<version> version`:
#   prints <version>          -> already published: skip, exit 0
#   E404, or empty with exit 0 -> not published: npm publish (older npm clients print nothing for a missing version)
#   anything else              -> fail closed, exit 1, nothing published (network, auth or registry error)
set -euo pipefail

usage() {
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
}

workspace=""
dry_run=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace)
      [[ $# -ge 2 && -n "$2" ]] || { echo "npm-publish-if-new: --workspace needs a package name" >&2; exit 2; }
      workspace="$2"
      shift 2
      ;;
    --dry-run) dry_run=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "npm-publish-if-new: unknown argument: $1" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Name and version of the package to publish: the root package.json, or the workspace whose name matches.
meta="$(WORKSPACE="$workspace" node -e '
  const fs = require("fs");
  const path = require("path");
  const want = process.env.WORKSPACE;
  const root = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const show = (p) => { console.log(`${p.name} ${p.version}`); process.exit(0); };
  if (!want) show(root);
  for (const pattern of root.workspaces ?? []) {
    const dirs = pattern.endsWith("/*")
      ? fs.readdirSync(pattern.slice(0, -2), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(pattern.slice(0, -2), d.name))
      : [pattern];
    for (const dir of dirs) {
      const file = path.join(dir, "package.json");
      if (!fs.existsSync(file)) continue;
      const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
      if (pkg.name === want) show(pkg);
    }
  }
  console.error(`npm-publish-if-new: no workspace named ${want}`);
  process.exit(2);
')" || exit 2
read -r name version <<<"$meta"

if [[ -z "${name:-}" || -z "${version:-}" ]]; then
  echo "npm-publish-if-new: could not read name and version" >&2
  exit 2
fi

set +e
view_out="$(npm view "${name}@${version}" version 2>&1)"
view_rc=$?
set -e
view_trimmed="$(printf '%s' "$view_out" | tr -d '[:space:]')"

if [[ $view_rc -eq 0 && "$view_trimmed" == "$version" ]]; then
  echo "npm-publish-if-new: ${name}@${version} already published, skipping"
  exit 0
fi

if ! { [[ $view_rc -eq 0 && -z "$view_trimmed" ]] || grep -q "E404" <<<"$view_out"; }; then
  echo "npm-publish-if-new: npm view ${name}@${version} failed (exit ${view_rc}); not publishing:" >&2
  printf '%s\n' "$view_out" >&2
  exit 1
fi

args=(publish)
[[ -n "$workspace" ]] && args+=(--workspace "$workspace")
if [[ $dry_run -eq 1 ]]; then
  args+=(--dry-run --access public)
  echo "npm-publish-if-new: ${name}@${version} not on npm; dry run: npm ${args[*]}"
else
  args+=(--provenance --access public)
  echo "npm-publish-if-new: ${name}@${version} not on npm; publishing"
fi
npm "${args[@]}"
