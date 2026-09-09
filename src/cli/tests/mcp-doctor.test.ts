/**
 * gxt_doctor MCP handler: environment readiness + ADR-0041 adapter preflight.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SKIPPED_MESSAGE } from "../lib/doctor-adapter-preflight.js";
import { handleDoctor, type DoctorMcpResult } from "../lib/mcp-doctor.js";
import { getRepoRoot } from "../lib/git.js";
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

test("handleDoctor: skips adapter preflight when no typed missions", () => {
  const dest = miniRepo();
  const result = withCwd(dest, () => handleDoctor({}));
  assert.ok(isReady(result), `expected ok|fail, got ${JSON.stringify(result)}`);
  assert.ok(
    result.lines.some((l) => l.message === SKIPPED_MESSAGE),
    `missing skip line in ${JSON.stringify(result.lines)}`,
  );
});

test("handleDoctor: gate_adapter tsc emits tsc preflight lines", () => {
  const dest = miniRepo();
  const result = withCwd(dest, () => handleDoctor({ gate_adapter: "tsc" }));
  assert.ok(isReady(result), `expected ok|fail, got ${JSON.stringify(result)}`);
  const joined = result.lines.map((l) => l.message).join("\n");
  assert.equal(result.lines.some((l) => l.message === SKIPPED_MESSAGE), false);
  assert.match(joined, /npx|typescript/);
});

test("handleDoctor: adapter_baseline omitted does not emit baseline lines", () => {
  const dest = miniRepo();
  const result = withCwd(dest, () => handleDoctor({ gate_adapter: "tsc" }));
  assert.ok(isReady(result), `expected ok|fail, got ${JSON.stringify(result)}`);
  assert.equal(
    result.lines.some((l) => l.message.includes("baseline tsc")),
    false,
  );
});

test("handleDoctor: error path returns DOCTOR_FAILED outside a gantry repo", () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "og-mcp-doctor-empty-"));
  const result = withCwd(dest, () => handleDoctor({}));
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "DOCTOR_FAILED");
  assert.equal(result.error.retryable, true);
  assert.ok(result.error.message.length > 0);
});
