#!/usr/bin/env bash
# Assert templates/scripts dogfood copies match generated scripts/ (post gen-dogfood)
# and that MIRRORED workflow/schema paths stay byte-identical to templates/.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "assert-dogfood-sync: not inside a git repository" >&2
  exit 1
}
cd "$ROOT"

node scripts/gen-dogfood.mjs

MIRRORED=(
  .github/workflows/gxt-validate.yml
  .github/workflows/gxt-attest-ingest.yml
  .gitagent/planner/MISSION.schema.yaml
  .gitagent/planner/ORG-POLICY.schema.yaml
)

DIFF_PATHS=(scripts/ templates/scripts/)
for rel in "${MIRRORED[@]}"; do
  DIFF_PATHS+=("$rel" "templates/$rel")
done

if ! git diff --exit-code -- "${DIFF_PATHS[@]}" >/dev/null; then
  echo "assert-dogfood-sync: dogfood paths drifted after gen-dogfood" >&2
  echo "assert-dogfood-sync: run npm run gen:dogfood and commit the copies" >&2
  git diff --stat -- "${DIFF_PATHS[@]}" >&2 || true
  exit 1
fi

echo "assert-dogfood-sync: scripts/ matches templates/scripts/ and mirrored files match"
