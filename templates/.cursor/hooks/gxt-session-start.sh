#!/usr/bin/env bash
# Cursor sessionStart — inject GXT mission scope + runtime env for OpenGantry dogfood.
set -euo pipefail

ROOT="${CURSOR_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo "")}}"
if [ -z "$ROOT" ]; then
  exit 0
fi
cd "$ROOT"

MISSION=""
if MISSION="$(scripts/gxt-resolve-mission.sh 2>/dev/null)"; then
  :
else
  node -e '
    process.stdout.write(JSON.stringify({
      additional_context: "No active mission pinned. Ask me to run the Mission Architect protocol, or run gapman legislate.",
    }));
  '
  exit 0
fi

RUNTIME_JSON=""
if command -v gapman >/dev/null 2>&1; then
  RUNTIME_JSON="$(gapman runtime env --mission "$MISSION" --json 2>/dev/null || true)"
elif [ -f "dist/cli/index.js" ]; then
  RUNTIME_JSON="$(node dist/cli/index.js runtime env --mission "$MISSION" --json 2>/dev/null || true)"
fi

if [ -z "$RUNTIME_JSON" ]; then
  node -e '
    process.stdout.write(JSON.stringify({
      additional_context: "GXT: gapman not built — run npm ci && npm run build, then scripts/gxt-pin-mission.sh <mission>",
    }));
  '
  exit 0
fi

node -e '
const mission = process.argv[1];
const runtimeJson = process.argv[2];
let payload;
try {
  payload = JSON.parse(runtimeJson);
} catch {
  process.stdout.write(JSON.stringify({ additional_context: "GXT: failed to parse runtime env" }));
  process.exit(0);
}
const tmvc = (payload.GXT_TMVC_ROOTS || "").split("\n").filter(Boolean);
const forbidden = (payload.GXT_FORBIDDEN_ZONES || "").split("\n").filter(Boolean);
process.stdout.write(JSON.stringify({
  env: payload,
  additional_context: [
    "GXT OpenGantry active mission (auto-loaded at session start):",
    `- Mission: ${payload.GXT_MISSION_FILE || mission} (${payload.GXT_MSN_ID || "no MSN"})`,
    `- Skill: ${payload.GXT_SKILL_KEY || "unknown"}`,
    `- TMVC roots: ${tmvc.join(", ") || "(none)"}`,
    `- Forbidden: ${forbidden.join(", ") || "(none)"}`,
    `- Trace sink: ${payload.GXT_WORKER_LOG || "WORKER_LOG.md"}`,
    "",
    "Worker loop: edit within TMVC → append PASS quotes to WORKER_LOG.md → gapman verify --mission … → npm run validate",
    "IDE Agent edits are advisory TMVC; shell substrate writes are hook-guarded. Full loop: docs/DEVELOPMENT.md",
  ].join("\n"),
}));
' "$MISSION" "$RUNTIME_JSON"

exit 0
