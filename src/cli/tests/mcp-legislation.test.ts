import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import {
  handleDraftLegislation,
  handleExecuteLegislation,
  handleCheckSignature,
} from "../lib/mcp-legislation.js";
import { getRepoRoot } from "../lib/git.js";

function scaffoldRepo(): string {
  const ogRoot = getRepoRoot();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-mcp-leg-"));
  fs.mkdirSync(path.join(dest, ".gitagent", "foreman"), { recursive: true });
  fs.mkdirSync(path.join(dest, ".gitagent", "missions"), { recursive: true });
  fs.copyFileSync(
    path.join(ogRoot, ".gitagent", "foreman", "MANIFEST.json"),
    path.join(dest, ".gitagent", "foreman", "MANIFEST.json"),
  );
  execSync("git init", { cwd: dest, stdio: "pipe" });
  execSync('git config user.email "teacher@example.com"', { cwd: dest, stdio: "pipe" });
  execSync("git add .", { cwd: dest, stdio: "pipe" });
  execSync('git commit -m "init"', { cwd: dest, stdio: "pipe" });
  return dest;
}

test("mcp legislation: draft does not write mission file", () => {
  const dest = scaffoldRepo();
  const prevCwd = process.cwd();
  process.chdir(dest);
  try {
    const draft = handleDraftLegislation({
      title: "Add button hover",
      msn_id: "MSN-0201",
      skill_key: "ui",
      gate_command: "echo OK",
      gate_success_substring: "OK",
    });
    assert.equal(draft.status, "awaiting_human_approval");
    if (draft.status !== "awaiting_human_approval") return;
    assert.ok(draft.draft_token.includes("."));
    const missions = fs.readdirSync(path.join(dest, ".gitagent", "missions"));
    assert.equal(missions.length, 0);
  } finally {
    process.chdir(prevCwd);
  }
});

test("mcp legislation: execute writes mission and returns pending_signature", () => {
  const dest = scaffoldRepo();
  const prevCwd = process.cwd();
  process.chdir(dest);
  try {
    const draft = handleDraftLegislation({
      title: "Add button hover",
      msn_id: "MSN-0202",
      skill_key: "ui",
      gate_command: "echo OK",
      gate_success_substring: "OK",
    });
    if (draft.status !== "awaiting_human_approval") {
      assert.fail("expected draft");
      return;
    }

    const executed = handleExecuteLegislation(draft.draft_token);
    assert.equal(executed.status, "pending_signature");
    if (executed.status !== "pending_signature") return;
    assert.equal(executed.msn_id, "MSN-0202");
    assert.ok(executed.suggested_human_action.includes("git commit"));
    assert.ok(fs.existsSync(path.join(dest, executed.mission_file_path)));

    const check = handleCheckSignature(executed.mission_file_path);
    assert.equal(check.status, "signature_missing");
  } finally {
    process.chdir(prevCwd);
  }
});

test("mcp legislation: check_signature valid after teacher commit", () => {
  const dest = scaffoldRepo();
  const prevCwd = process.cwd();
  process.env.GAPMAN_TEACHER_EMAILS = "teacher@example.com";
  process.chdir(dest);
  try {
    const draft = handleDraftLegislation({
      title: "Signed mission",
      msn_id: "MSN-0203",
      skill_key: "ui",
      gate_command: "echo OK",
      gate_success_substring: "OK",
    });
    if (draft.status !== "awaiting_human_approval") return;
    const executed = handleExecuteLegislation(draft.draft_token);
    if (executed.status !== "pending_signature") return;

    execSync(`git add ${executed.mission_file_path}`, { cwd: dest, stdio: "pipe" });
    execSync(`git commit -m "${executed.commit_message}"`, { cwd: dest, stdio: "pipe" });

    const check = handleCheckSignature(executed.mission_file_path);
    assert.equal(check.status, "signature_valid");
    if (check.status === "signature_valid") {
      assert.equal(check.msn_id, "MSN-0203");
    }
  } finally {
    process.chdir(prevCwd);
  }
});

test("mcp legislation: execute restores process.exitCode after failure", () => {
  const dest = scaffoldRepo();
  const prevCwd = process.cwd();
  const prevExitCode = process.exitCode;
  process.chdir(dest);
  try {
    const draft = handleDraftLegislation({
      title: "Exit code leak guard",
      msn_id: "MSN-0204",
      skill_key: "ui",
      gate_command: "echo OK",
      gate_success_substring: "OK",
    });
    if (draft.status !== "awaiting_human_approval") {
      assert.fail("expected draft");
      return;
    }

    const collidingMission = path.join(dest, ".gitagent", "missions", "MSN-0204.exit-code-leak-guard.yaml");
    fs.writeFileSync(collidingMission, "msn_id: MSN-0204\nskill_key: ui\ngate_command: echo OK\ntrace_rows: []\n", "utf8");

    process.exitCode = 0;
    const executed = handleExecuteLegislation(draft.draft_token);
    assert.equal(executed.status, "error");
    assert.equal(process.exitCode, 0);
  } finally {
    process.exitCode = prevExitCode;
    process.chdir(prevCwd);
  }
});
