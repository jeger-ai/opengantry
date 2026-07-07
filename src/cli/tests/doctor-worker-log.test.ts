import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runWorkerLogIntegrityDoctorChecks } from "../lib/worker-log-integrity.js";

test("runWorkerLogIntegrityDoctorChecks: detects conflict markers and duplicates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-wl-doc-"));
  fs.writeFileSync(
    path.join(root, "WORKER_LOG.md"),
    [
      "## MSN-TEST",
      "- DoD 1 MSN-TEST: identical trace line",
      "- DoD 1 MSN-TEST: identical trace line",
      "<<<<<<< HEAD",
    ].join("\n"),
    "utf8",
  );
  const lines = runWorkerLogIntegrityDoctorChecks(root);
  assert.ok(lines.some((l) => l.message.includes("merge conflict")));
  assert.ok(lines.some((l) => l.message.includes("duplicate")));
});

test("runWorkerLogIntegrityDoctorChecks: no-op when log missing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "og-wl-miss-"));
  assert.equal(runWorkerLogIntegrityDoctorChecks(root).length, 0);
});
