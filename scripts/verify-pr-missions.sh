#!/usr/bin/env bash
# PR / branch mission verify: triple-dot file diff, full gapman verify on changed missions.
# Usage:
#   BASE_SHA=<base> HEAD_SHA=<head> ./scripts/verify-pr-missions.sh
#   ./scripts/verify-pr-missions.sh <base-ref> <head-ref>   # rev-parse refs to SHAs
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "verify-pr-missions: not inside a git repository" >&2
  exit 1
}
cd "$ROOT"

GXT_MANIFEST_LIB="scripts/gxt-manifest-lib.mjs"
MISSIONS_PREFIX=".gitagent/missions/"

resolve_sha() {
  git rev-parse --verify "${1}^{commit}" 2>/dev/null
}

if [[ -n "${1:-}" && -n "${2:-}" ]]; then
  BASE_SHA="$(resolve_sha "$1")" || {
    echo "verify-pr-missions: invalid base ref: $1" >&2
    exit 2
  }
  HEAD_SHA="$(resolve_sha "$2")" || {
    echo "verify-pr-missions: invalid head ref: $2" >&2
    exit 2
  }
elif [[ -n "${BASE_SHA:-}" && -n "${HEAD_SHA:-}" ]]; then
  BASE_SHA="$(resolve_sha "$BASE_SHA")" || {
    echo "verify-pr-missions: invalid BASE_SHA" >&2
    exit 2
  }
  HEAD_SHA="$(resolve_sha "$HEAD_SHA")" || {
    echo "verify-pr-missions: invalid HEAD_SHA" >&2
    exit 2
  }
else
  echo "verify-pr-missions: set BASE_SHA and HEAD_SHA, or pass <base-ref> <head-ref>" >&2
  echo "  CI: BASE_SHA=\${{ github.event.pull_request.base.sha }} HEAD_SHA=\${{ github.event.pull_request.head.sha }}" >&2
  exit 2
fi

if command -v gapman >/dev/null 2>&1; then
  GAPMAN=(gapman)
elif [[ -f dist/cli/index.js ]]; then
  GAPMAN=(node dist/cli/index.js)
else
  echo "verify-pr-missions: build gapman first (npm run build)" >&2
  exit 1
fi

is_verifiable_mission() {
  local p="$1"
  [[ "$p" == "${MISSIONS_PREFIX}"* ]] || return 1
  [[ "$p" =~ \.(ya?ml|md)$ ]] || return 1
  [[ "$(basename "$p")" == "README.md" ]] && return 1
  return 0
}

is_msn_enforced_path() {
  local p="$1"
  local prefix
  for prefix in "${MSN_PREFIXES[@]}"; do
    [[ -z "$prefix" ]] && continue
    if [[ "$p" == "$prefix" ]]; then return 0; fi
    if [[ "$prefix" == */ ]] && [[ "$p" == "$prefix"* ]]; then return 0; fi
    if [[ "$prefix" != */ ]] && [[ "$p" == "$prefix"/* ]]; then return 0; fi
  done
  return 1
}

mapfile -t MSN_PREFIXES < <(node "$GXT_MANIFEST_LIB" prefixes "$ROOT")

mapfile -t DIFF_FILES < <(
  git diff --name-only --diff-filter=ACMRT "${BASE_SHA}...${HEAD_SHA}" || true
)

needs_mission=0
for f in "${DIFF_FILES[@]}"; do
  [[ -n "$f" ]] || continue
  if is_msn_enforced_path "$f"; then
    needs_mission=1
    break
  fi
done

mapfile -t CHANGED_MISSIONS < <(
  for f in "${DIFF_FILES[@]}"; do
    [[ -n "$f" ]] || continue
    if is_verifiable_mission "$f" && [[ -f "$f" ]]; then
      echo "$f"
    fi
  done | sort -u
)

if [[ "$needs_mission" -eq 1 && ${#CHANGED_MISSIONS[@]} -eq 0 ]]; then
  echo "verify-pr-missions FAILED: diff touches MSN-enforced paths but no mission file under ${MISSIONS_PREFIX}" >&2
  echo "  Fix: gapman legislate \"<intent>\" --msn MSN-NNNN --skill-key gapman && include mission YAML in this PR" >&2
  exit 1
fi

if [[ ${#CHANGED_MISSIONS[@]} -eq 0 ]]; then
  echo "verify-pr-missions: no changed mission files (${BASE_SHA}...${HEAD_SHA})"
  exit 0
fi

for mission in "${CHANGED_MISSIONS[@]}"; do
  echo "verify-pr-missions: gapman verify --mission ${mission}" >&2
  "${GAPMAN[@]}" verify --mission "$mission" --audience verifier || exit 1
done

echo "verify-pr-missions OK (${#CHANGED_MISSIONS[@]} mission(s))"
