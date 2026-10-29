/**
 * gxt_doctor MCP handler: the readiness checks that decide whether a repository works.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleDoctor, type DoctorMcpResult } from "../mcp/mcp-doctor.js";
import { getRepoRoot } from "#git/git.js";
import { writeMiniGantryRepo, gitInitCommit } from "./test-fixtures.js";
import { PLANNER_EMAIL } from "./test-shared.js";

function withCwd<T>(dir: string, fn: () => T): T {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(prev);
  }
}

function miniRepo(): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-mcp-doctor-"));
  writeMiniGantryRepo(dest, getRepoRoot());
  gitInitCommit(dest, "[MSN-0999] init", PLANNER_EMAIL);
  return dest;
}

function isReady(result: DoctorMcpResult): result is Extract<DoctorMcpResult, { status: "ok" | "fail" }> {
  return result.status === "ok" || result.status === "fail";
}

test("handleDoctor: reports the decisive checks and no advisory ones", () => {
  const dest = miniRepo();
  const result = withCwd(dest, () => handleDoctor());
  assert.ok(isReady(result), `expected ok|fail, got ${JSON.stringify(result)}`);
  const joined = result.lines.map((l) => l.message).join("\n");
  assert.match(joined, /Planner allowlist/);
  assert.match(joined, /core\.hooksPath/);
  assert.match(joined, /substrate version/);
  assert.doesNotMatch(joined, /adapter preflight|detected agent wiring|architecture pointer|refs\/gxt\/ledger|BYPASS/);
});

test("handleDoctor: error path returns DOCTOR_FAILED outside a gantry repo", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-mcp-doctor-empty-"));
  const result = withCwd(dest, () => handleDoctor());
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "DOCTOR_FAILED");
  assert.equal(result.error.retryable, true);
  assert.ok(result.error.message.length > 0);
});
