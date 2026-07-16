#!/usr/bin/env bash
# Fail when user-facing paths still reference legacy gapman/GAPMAN naming outside the allowlist.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "assert-no-stale-cli-naming: not inside a git repository" >&2
  exit 1
}
cd "$ROOT"

if ! command -v rg >/dev/null 2>&1; then
  echo "assert-no-stale-cli-naming: ripgrep (rg) required" >&2
  exit 1
fi

mapfile -t hits < <(
  rg -i 'gapman|GAPMAN' \
    --glob '!node_modules/**' \
    --glob '!.git/**' \
    --glob '!package-lock.json' \
    --glob '!docs/archive/**' \
    --glob '!.gitagent/missions/**' \
    --glob '!.gitagent/out-of-scope/**' \
    --glob '!EXECUTOR_LOG.md' \
    --glob '!package.json' \
    --glob '!src/cli/lib/config-namespace.ts' \
    --glob '!src/cli/lib/skill-key.ts' \
    --glob '!src/cli/lib/constants.ts' \
    --glob '!src/cli/tests/config-namespace.test.ts' \
    --glob '!src/cli/tests/skill-key.test.ts' \
    --glob '!src/cli/tests/planner-identity.test.ts' \
    --glob '!src/cli/tests/metrics-classification.test.ts' \
    --glob '!src/cli/tests/missions/mission-path-resolution.test.ts' \
    --glob '!docs/SECURITY.md' \
    --glob '!docs/CHANGELOG.md' \
    --glob '!scripts/assert-no-stale-cli-naming.sh' \
    --glob '!.gitagent/planner/RULES.md' \
    --glob '!.gitagent/planner/MISSION-ARCHITECT.md' \
    -l . 2>/dev/null || true
)

if [[ ${#hits[@]} -gt 0 ]]; then
  echo "assert-no-stale-cli-naming FAILED: legacy CLI naming outside allowlist:" >&2
  printf '  %s\n' "${hits[@]}" >&2
  echo "  Fix naming to gantry/GANTRY_* or add an intentional legacy allowlist entry in scripts/assert-no-stale-cli-naming.sh" >&2
  exit 1
fi

echo "assert-no-stale-cli-naming OK"
