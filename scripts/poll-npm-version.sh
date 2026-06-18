#!/usr/bin/env bash
# Poll npm registry until target version propagates (edge-cache safe).
set -euo pipefail

PACKAGE="${1:-@jeger-ai/opengantry}"
TARGET="${2:?poll-npm-version: target version required}"
MAX_ATTEMPTS="${3:-5}"
BASE_WAIT_SEC="${4:-30}"

attempt=1
while [[ "$attempt" -le "$MAX_ATTEMPTS" ]]; do
  published="$(npm view "${PACKAGE}" version 2>/dev/null || true)"
  if [[ "$published" == "$TARGET" ]]; then
    echo "poll-npm-version OK — ${PACKAGE}@${TARGET} visible on registry (attempt ${attempt})"
    exit 0
  fi
  echo "poll-npm-version: attempt ${attempt}/${MAX_ATTEMPTS} — registry=${published:-unknown} want=${TARGET}"
  if [[ "$attempt" -eq "$MAX_ATTEMPTS" ]]; then
    echo "poll-npm-version: ${PACKAGE}@${TARGET} not visible after ${MAX_ATTEMPTS} attempts" >&2
    exit 1
  fi
  wait_sec=$((BASE_WAIT_SEC * attempt))
  sleep "$wait_sec"
  attempt=$((attempt + 1))
done
