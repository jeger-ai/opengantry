import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendSurgeonMutationLog } from "../lib/surgeon.js";

test("appendSurgeonMutationLog: prefixes and appends immutable line", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-surgeon-log-"));
  const logPath = path.join(dir, "EXECUTOR_LOG.md");
  fs.writeFileSync(logPath, "existing evidence\n", "utf8");

  appendSurgeonMutationLog(logPath, "banned-import quarantined: src/bad.ts:1 -> RULE-BANNED-IMPORT");

  const content = fs.readFileSync(logPath, "utf8");
  assert.match(content, /existing evidence/);
  assert.match(content, /\[SURGEON-MUTATION\] banned-import quarantined: src\/bad\.ts:1 -> RULE-BANNED-IMPORT/);
});

test("appendSurgeonMutationLog: creates log when missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-surgeon-log-new-"));
  const logPath = path.join(dir, "EXECUTOR_LOG.md");
  appendSurgeonMutationLog(logPath, "[SURGEON-MUTATION] already prefixed");
  assert.match(fs.readFileSync(logPath, "utf8"), /\[SURGEON-MUTATION\] already prefixed/);
});
