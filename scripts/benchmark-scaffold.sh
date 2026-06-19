#!/usr/bin/env bash
# Time-to-Scaffold benchmark: ephemeral repo init → legislate → verify --pre-push.
# Prints JSON timings to stdout. Requires built gapman (npm run build).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f dist/cli/index.js ]]; then
  echo "benchmark-scaffold: run npm run build first" >&2
  exit 1
fi

GAPMAN=(node "$ROOT/dist/cli/index.js")
MSN_ID="MSN-0999"
TEACHER_EMAIL="${BENCHMARK_TEACHER_EMAIL:-benchmark-teacher@example.com}"
export GAPMAN_TEACHER_EMAILS="${GAPMAN_TEACHER_EMAILS:-$TEACHER_EMAIL}"

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

elapsed_ms() {
  local start="$1" end="$2"
  echo $(( (10#${end} - 10#${start}) / 1000000 ))
}

now_ns() { date +%s%N; }

git -C "$TMP" init -q
git -C "$TMP" config user.email "$TEACHER_EMAIL"
git -C "$TMP" config user.name "Benchmark Teacher"
git -C "$TMP" commit --allow-empty -m "seed" -q

t0="$(now_ns)"
(cd "$TMP" && "${GAPMAN[@]}" init --yes --no-ci --no-hooks >/dev/null)
t1="$(now_ns)"

git -C "$TMP" add -A
git -C "$TMP" commit -m "post-init" -q

t2="$(now_ns)"
MISSION_REL="$(
  cd "$TMP" && "${GAPMAN[@]}" legislate "Benchmark scaffold mission" \
    --msn "$MSN_ID" --skill-key logic \
    --gate-command "echo benchmark-gate-ok" \
    --gate-success-substring "benchmark-gate-ok" 2>&1 \
    | sed -n 's/^gapman legislate: wrote //p'
)"
t3="$(now_ns)"

if [[ -z "$MISSION_REL" || ! -f "$TMP/$MISSION_REL" ]]; then
  echo "benchmark-scaffold: legislate did not write mission file" >&2
  exit 1
fi

git -C "$TMP" add "$MISSION_REL"
git -C "$TMP" commit -m "[$MSN_ID] legislate mission" -q

t4="$(now_ns)"
(cd "$TMP" && "${GAPMAN[@]}" verify --mission "$MISSION_REL" --pre-push >/dev/null)
t5="$(now_ns)"

INIT_MS="$(elapsed_ms "$t0" "$t1")"
LEGISLATE_MS="$(elapsed_ms "$t2" "$t3")"
VERIFY_MS="$(elapsed_ms "$t4" "$t5")"
TOTAL_MS="$(elapsed_ms "$t0" "$t5")"

printf '%s\n' "{
  \"benchmark\": \"time-to-scaffold\",
  \"schema_version\": 1,
  \"gapman\": \"local-dist\",
  \"timings_ms\": {
    \"init_yes_no_ci\": ${INIT_MS},
    \"legislate\": ${LEGISLATE_MS},
    \"verify_pre_push\": ${VERIFY_MS},
    \"total\": ${TOTAL_MS}
  },
  \"mission_file\": \"${MISSION_REL}\"
}"

echo "benchmark-scaffold OK" >&2
