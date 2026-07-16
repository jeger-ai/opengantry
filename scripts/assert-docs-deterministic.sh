#!/usr/bin/env bash
# Deterministic documentation metrics: published inventory, index link integrity, doc-surface naming drift.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "assert-docs-deterministic: not inside a git repository" >&2
  exit 1
}
cd "$ROOT"

fail() {
  echo "assert-docs-deterministic FAILED: $*" >&2
  exit 1
}

# --- 1. Published doc inventory (website + adopter surfaces) ---
REQUIRED_DOCS=(
  docs/index.md
  docs/ADOPTION.md
  docs/DEVELOPMENT.md
  docs/INTEGRATIONS.md
  docs/ARCHITECTURE.md
  docs/SECURITY.md
  docs/CHANGELOG.md
  docs/FEATURES.md
  README.md
  SECURITY.md
)

for doc in "${REQUIRED_DOCS[@]}"; do
  [[ -f "$doc" ]] || fail "missing required doc: ${doc}"
done

[[ -f docs/assets/opengantry-logo.svg ]] || fail "missing docs/assets/opengantry-logo.svg (referenced by docs/index.md)"

# Root SECURITY.md must point at canonical policy (GitHub Security tab stub).
if ! grep -q 'docs/SECURITY.md' SECURITY.md; then
  fail "root SECURITY.md must link to docs/SECURITY.md"
fi

# --- 2. docs/index.md link integrity (relative .md targets only) ---
INDEX="docs/index.md"
while IFS= read -r raw; do
  link="${raw#(}"
  link="${link%)}"
  [[ -z "$link" ]] && continue
  [[ "$link" == http://* || "$link" == https://* ]] && continue
  [[ "$link" == \#* ]] && continue

  if [[ "$link" == ../* ]]; then
    target="${link#../}"
    resolved="$target"
  else
    resolved="docs/${link}"
  fi

  # Strip URL fragment anchors before filesystem checks.
  resolved="${resolved%%#*}"

  # Directory links (e.g. out-of-scope/) — require path exists.
  if [[ "$resolved" == */ ]]; then
    [[ -d "$resolved" ]] || fail "broken index link (directory): ${link} → ${resolved}"
    continue
  fi

  [[ -f "$resolved" ]] || fail "broken index link: ${link} → ${resolved}"
done < <(grep -oE '\]\([^)]+\)' "$INDEX" | sed 's/^\](//')

echo "assert-docs-deterministic: inventory + index links OK"

# --- 3. Doc-surface legacy CLI naming drift ---
if ! command -v rg >/dev/null 2>&1; then
  fail "ripgrep (rg) required"
fi

DOC_PATHS=(
  README.md
  AGENTS.md
  SECURITY.md
  docs
  .gitagent/README.md
  .gitagent/planner
  templates/AGENTS.md
  templates/docs
)

mapfile -t naming_hits < <(
  rg -i 'gapman|GAPMAN' "${DOC_PATHS[@]}" \
    --glob '!docs/archive/**' \
    --glob '!docs/SECURITY.md' \
    --glob '!docs/CHANGELOG.md' \
    --glob '!.gitagent/planner/RULES.md' \
    --glob '!.gitagent/planner/MISSION-ARCHITECT.md' \
    --glob '!scripts/assert-no-stale-cli-naming.sh' \
    --glob '!scripts/assert-docs-deterministic.sh' \
    -l 2>/dev/null || true
)

if [[ ${#naming_hits[@]} -gt 0 ]]; then
  echo "assert-docs-deterministic FAILED: legacy CLI naming on documentation surfaces:" >&2
  printf '  %s\n' "${naming_hits[@]}" >&2
  echo "  Use gantry/GANTRY_* in docs; allowlist intentional legacy notes in scripts/assert-docs-deterministic.sh" >&2
  exit 1
fi

echo "assert-docs-deterministic OK"
