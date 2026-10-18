#!/usr/bin/env bash
# Cursor sessionStart — inject GXT mission scope + runtime env for OpenGantry dogfood.
set -euo pipefail

ROOT="${CURSOR_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo "")}}"
if [ -z "$ROOT" ]; then
  exit 0
fi
cd "$ROOT"

# gantry resolves the pinned mission itself (gantry pin <file>, GANTRY_MISSION, the legacy ACTIVE_MISSION files).
RUNTIME_JSON=""
if command -v gantry >/dev/null 2>&1; then
  RUNTIME_JSON="$(gantry runtime env --json 2>/dev/null)" || RUNTIME_JSON=""
elif [ -f "dist/cli/index.js" ]; then
  RUNTIME_JSON="$(node dist/cli/index.js runtime env --json 2>/dev/null)" || RUNTIME_JSON=""
else
  node -e '
    process.stdout.write(JSON.stringify({
      additional_context: "GXT: gantry not built — run npm ci && npm run build, then gantry pin <mission>",
    }));
  '
  exit 0
fi

if [ -z "$RUNTIME_JSON" ]; then
  node -e '
    process.stdout.write(JSON.stringify({
      additional_context: "No active mission pinned. Ask me to run the Mission Architect protocol (MCP: gxt_draft_legislation) or gantry legislate, then gantry pin <mission>.",
    }));
  '
  exit 0
fi

node -e '
const runtimeJson = process.argv[1];
const mission = "";
let payload;
try {
  payload = JSON.parse(runtimeJson);
} catch {
  process.stdout.write(JSON.stringify({ additional_context: "GXT: failed to parse runtime env" }));
  process.exit(0);
}
const tmvc = (payload.GANTRY_TMVC_ROOTS_ABSOLUTE || "").split("\n").filter(Boolean);
const forbidden = (payload.GANTRY_FORBIDDEN_ZONES || "").split("\n").filter(Boolean);
process.stdout.write(JSON.stringify({
  env: payload,
  additional_context: [
    "GXT OpenGantry active mission (auto-loaded at session start):",
    `- Mission: ${payload.GANTRY_MISSION_FILE || mission} (${payload.GANTRY_MSN_ID || "no MSN"})`,
    `- Skill: ${payload.GANTRY_SKILL_KEY || "unknown"}`,
    `- TMVC roots: ${tmvc.join(", ") || "(none)"}`,
    `- Forbidden: ${forbidden.join(", ") || "(none)"}`,
    `- Trace sink: ${payload.GANTRY_EXECUTOR_LOG || "EXECUTOR_LOG.md"}`,
    "",
    "Executor graph: edit within TMVC → append PASS quotes to EXECUTOR_LOG.md → gantry verify --mission … → npm run validate",
    "MCP tools: gxt_draft_legislation, gxt_execute_legislation, gxt_check_signature, gxt_pin_mission, gxt_runtime_env, gxt_verify (see .cursor/mcp.json).",
    "IDE Agent edits are advisory TMVC; shell substrate writes are hook-guarded. Full graph: docs/DEVELOPMENT.md",
  ].join("\n"),
}));
' "$RUNTIME_JSON"

exit 0
