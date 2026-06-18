#!/usr/bin/env bash
# Race-safe v2.1.0+ release gate: tag -> block on npm CI -> poll registry -> promote GH release.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "release-gate-publish: not inside a git repository" >&2
  exit 1
}
cd "$ROOT"

TAG="${1:?release-gate-publish: tag required (e.g. v2.1.0)}"
VERSION="${TAG#v}"
RELEASE_TITLE="${2:-OpenGantry ${VERSION}}"
DRAFT_ID="${3:-}"

echo "release-gate-publish: preflight version parity"
./scripts/assert-cli-version-parity.sh

if git ls-remote --tags origin "refs/tags/${TAG}" | grep -q "${TAG}"; then
  echo "release-gate-publish: tag ${TAG} already exists on origin — skipping tag push"
else
  echo "release-gate-publish: creating annotated tag ${TAG}"
  git tag -a "${TAG}" -m "OpenGantry ${VERSION}"
  git push origin "${TAG}"
fi

echo "release-gate-publish: waiting for npm-publish workflow on ${TAG}"
if ! gh run list --workflow npm-publish.yml --limit 10 --json headBranch,conclusion,status,databaseId \
  | node -e "
const fs = require('fs');
const runs = JSON.parse(fs.readFileSync(0, 'utf8'));
const tag = process.argv[1];
const match = runs.find(r => r.headBranch === tag);
if (!match) process.exit(2);
if (match.status !== 'completed') process.exit(3);
if (match.conclusion !== 'success') process.exit(4);
console.log(match.databaseId);
" "${TAG}" 2>/dev/null; then
  echo "release-gate-publish: polling workflow status (up to 20 min)..."
  for _ in $(seq 1 40); do
    run_id="$(gh run list --workflow npm-publish.yml --limit 5 --json headBranch,databaseId,status,conclusion \
      | node -e "
const runs = JSON.parse(require('fs').readFileSync(0,'utf8'));
const tag = process.argv[1];
const m = runs.find(r => r.headBranch === tag);
if (m) console.log(JSON.stringify(m));
" "${TAG}" 2>/dev/null || true)"
    if [[ -n "$run_id" ]]; then
      status="$(echo "$run_id" | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).status")"
      conclusion="$(echo "$run_id" | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).conclusion")"
      if [[ "$status" == "completed" ]]; then
        if [[ "$conclusion" != "success" ]]; then
          echo "release-gate-publish: npm-publish workflow failed (conclusion=${conclusion})" >&2
          echo "release-gate-publish: keep GitHub release draft; inspect gh run view" >&2
          exit 1
        fi
        break
      fi
    fi
    sleep 30
  done
fi

echo "release-gate-publish: polling npm registry for ${VERSION}"
./scripts/poll-npm-version.sh @jeger-ai/opengantry "${VERSION}"

if [[ -n "$DRAFT_ID" ]]; then
  echo "release-gate-publish: promoting draft release ${DRAFT_ID} to live"
  gh release edit "${TAG}" --draft=false --latest
else
  if gh release view "${TAG}" >/dev/null 2>&1; then
    echo "release-gate-publish: promoting existing release ${TAG} to live"
    gh release edit "${TAG}" --draft=false --latest
  else
    echo "release-gate-publish: creating live GitHub release ${TAG}"
    gh release create "${TAG}" --title "${RELEASE_TITLE}" --generate-notes --latest
  fi
fi

echo "release-gate-publish OK — ${TAG} on npm and GitHub"
