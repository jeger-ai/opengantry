import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  handleDraftLegislation,
  handleExecuteLegislation,
  handleCheckSignature,
  handlePinMission,
} from "../dist/cli/lib/mcp-legislation.js";
import { handleRuntimeEnv } from "../dist/cli/lib/mcp-runtime.js";

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

const addResult = spawnSync("git", ["add", "--", executed.mission_file_path], {
  cwd: dest,
  stdio: "inherit",
});
if (addResult.status !== 0) throw new Error("git add failed");

const commitResult = spawnSync("git", ["commit", "-m", executed.commit_message], {
  cwd: dest,
  stdio: "inherit",
});
if (commitResult.status !== 0) throw new Error("git commit failed");

const valid = handleCheckSignature(executed.mission_file_path);
if (valid.status !== "signature_valid") throw new Error("expected valid signature");

const pinned = handlePinMission(executed.mission_file_path);
if (pinned.status !== "pinned") throw new Error("pin failed");

const env = handleRuntimeEnv(executed.mission_file_path);
if (env.status !== "ok") throw new Error(`runtime env failed: ${JSON.stringify(env)}`);

console.log("OK: MCP dogfood flow passed");
