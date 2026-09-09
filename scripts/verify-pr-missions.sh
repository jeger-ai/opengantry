#!/usr/bin/env bash
# PR / branch mission verify: mission purity, triple-dot file diff, full gantry verify on changed missions.
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

if [[ -f dist/cli/index.js ]]; then
  GANTRY=(node dist/cli/index.js)
elif command -v gantry >/dev/null 2>&1; then
  GANTRY=(gantry)
else
  echo "verify-pr-missions: build gantry first (npm run build)" >&2
  exit 1
fi

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

changed_json="$("${GANTRY[@]}" mission changed --base-ref "$BASE_SHA" --head-ref "$HEAD_SHA" --json)" || {
  printf '%s\n' "$changed_json" >&2
  exit 1
}
mapfile -t CHANGED_MISSIONS < <(
  printf '%s' "$changed_json" | node -e '
    let s = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { s += c; });
    process.stdin.on("end", () => {
      const j = JSON.parse(s);
      if (j.status !== "ok") {
        console.error(j.message || "mission changed failed");
        process.exit(1);
      }
      for (const m of j.missions || []) console.log(m);
    });
  '
)
if [[ ${#CHANGED_MISSIONS[@]} -eq 1 && -z "${CHANGED_MISSIONS[0]:-}" ]]; then
  CHANGED_MISSIONS=()
fi

if [[ "$needs_mission" -eq 1 && ${#CHANGED_MISSIONS[@]} -eq 0 ]]; then
  if eval_out="$(node "$GXT_MANIFEST_LIB" eval-range "$ROOT" "$BASE_SHA" "$HEAD_SHA" 2>&1)"; then
    echo "$eval_out" >&2
    echo "verify-pr-missions: trusted automation policy satisfied — mission file not required"
    exit 0
  fi
  echo "verify-pr-missions FAILED: diff touches MSN-enforced paths but no mission file under ${MISSIONS_PREFIX}" >&2
  echo "  Fix: gantry legislate \"<intent>\" --msn MSN-NNNN --skill-key gantry && include mission YAML in this PR" >&2
  echo "  Or: declare eligible automation in .gitagent/config.json trusted_automation (fail-closed by default)" >&2
  exit 1
fi

if [[ ${#CHANGED_MISSIONS[@]} -eq 0 ]]; then
  echo "verify-pr-missions: no changed mission files (${BASE_SHA}...${HEAD_SHA})"
  exit 0
fi

for mission in "${CHANGED_MISSIONS[@]}"; do
  echo "verify-pr-missions: gantry verify --mission ${mission}" >&2
  "${GANTRY[@]}" verify --mission "$mission" --audience verifier || exit 1
done

echo "verify-pr-missions OK (${#CHANGED_MISSIONS[@]} mission(s))"
