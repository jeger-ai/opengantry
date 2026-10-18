import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendRepairMutationLog } from "../lib/repair.js";

test("appendRepairMutationLog: prefixes and appends immutable line", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-repair-log-"));
  const logPath = path.join(dir, "EXECUTOR_LOG.md");
  fs.writeFileSync(logPath, "existing evidence\n", "utf8");

  appendRepairMutationLog(logPath, "banned-import quarantined: src/bad.ts:1 -> RULE-BANNED-IMPORT");

  const content = fs.readFileSync(logPath, "utf8");
  assert.match(content, /existing evidence/);
  assert.match(content, /\[SURGEON-MUTATION\] banned-import quarantined: src\/bad\.ts:1 -> RULE-BANNED-IMPORT/);
});

test("appendRepairMutationLog: creates log when missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-repair-log-new-"));
  const logPath = path.join(dir, "EXECUTOR_LOG.md");
  appendRepairMutationLog(logPath, "[SURGEON-MUTATION] already prefixed");
  assert.match(fs.readFileSync(logPath, "utf8"), /\[SURGEON-MUTATION\] already prefixed/);
});
