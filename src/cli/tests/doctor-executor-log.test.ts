import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runExecutorLogIntegrityDoctorChecks } from "../lib/executor-log-integrity.js";

test("runExecutorLogIntegrityDoctorChecks: detects conflict markers and duplicates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-wl-doc-"));
  fs.writeFileSync(
    path.join(root, "EXECUTOR_LOG.md"),
    [
      "## MSN-TEST",
      "- DoD 1 MSN-TEST: identical trace line",
      "- DoD 1 MSN-TEST: identical trace line",
      "<<<<<<< HEAD",
    ].join("\n"),
    "utf8",
  );
  const lines = runExecutorLogIntegrityDoctorChecks(root);
  assert.ok(lines.some((l) => l.message.includes("merge conflict")));
  assert.ok(lines.some((l) => l.message.includes("duplicate")));
});

test("runExecutorLogIntegrityDoctorChecks: no-op when log missing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-wl-miss-"));
  assert.equal(runExecutorLogIntegrityDoctorChecks(root).length, 0);
});
