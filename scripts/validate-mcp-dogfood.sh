#!/usr/bin/env bash
# Dogfood validation: MCP two-step legislation state machine (no Cursor required).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

npm run build >/dev/null

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p "$TMP/.gitagent/foreman" "$TMP/.gitagent/missions" "$TMP/.gitagent/teacher"
cp .gitagent/foreman/MANIFEST.json "$TMP/.gitagent/foreman/MANIFEST.json"
cp .gitagent/teacher/MISSION.schema.yaml "$TMP/.gitagent/teacher/MISSION.schema.yaml"
git -C "$TMP" init -q
git -C "$TMP" config user.email "teacher@example.com"
git -C "$TMP" add .
git -C "$TMP" commit -m "init" -q

export GAPMAN_TEACHER_EMAILS="teacher@example.com"
export GXT_DOGFOOD_TMP="$TMP"

node --input-type=module <<'NODE'
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  handleDraftLegislation,
  handleExecuteLegislation,
  handleCheckSignature,
  handlePinMission,
} from "./dist/cli/lib/mcp-legislation.js";
import { handleRuntimeEnv } from "./dist/cli/lib/mcp-runtime.js";

const dest = process.env.GXT_DOGFOOD_TMP;
if (!dest) throw new Error("GXT_DOGFOOD_TMP unset");
process.chdir(dest);

const draft = handleDraftLegislation({
  title: "Dogfood MCP flow",
  msn_id: "MSN-0301",
  skill_key: "ui",
  gate_command: "echo OK",
  gate_success_substring: "OK",
});
if (draft.status !== "awaiting_human_approval") throw new Error("draft failed");

const before = fs.readdirSync(path.join(dest, ".gitagent", "missions"));
if (before.length !== 0) throw new Error("draft wrote files");

const executed = handleExecuteLegislation(draft.draft_token);
if (executed.status !== "pending_signature") throw new Error("execute failed");

const missing = handleCheckSignature(executed.mission_file_path);
if (missing.status !== "signature_missing") throw new Error("expected missing signature");

execSync(executed.suggested_human_action, { cwd: dest, shell: "/bin/bash" });

const valid = handleCheckSignature(executed.mission_file_path);
if (valid.status !== "signature_valid") throw new Error("expected valid signature");

const pinned = handlePinMission(executed.mission_file_path);
if (pinned.status !== "pinned") throw new Error("pin failed");

const env = handleRuntimeEnv(executed.mission_file_path);
if (env.status !== "ok") throw new Error("runtime env failed");

console.log("OK: MCP dogfood flow passed");
NODE

echo "scripts/validate-mcp-dogfood.sh: passed"
