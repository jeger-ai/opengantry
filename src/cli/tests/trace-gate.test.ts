import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { verifyTraceRows } from "../lib/trace.js";
import { gatePassed } from "../lib/gate.js";
import { parseOptionalTimeoutMs } from "../lib/cli-io.js";

test("verifyTraceRows: anchor line must contain quote", () => {
  const log = "line one\nline two evidence here\n";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-trace-"));
  const p = path.join(dir, "WORKER_LOG.md");
  fs.writeFileSync(p, log, "utf8");
  const ok = verifyTraceRows(p, [
    { dodId: "1", traceQuote: "evidence here", anchor: "2", status: "PASS" as const },
  ]);
  assert.equal(ok.failures.length, 0);
  const bad = verifyTraceRows(
    p,
    [{ dodId: "1", traceQuote: "evidence here", anchor: "1", status: "PASS" as const }],
    { strictTrace: true },
  );
  assert.ok(bad.failures.length > 0);
});

test("gatePassed: exit code and substring rules", () => {
  assert.equal(
    gatePassed({ exitCode: 1, stdout: "", stderr: "", combined: "" }, null),
    false,
  );
  assert.equal(gatePassed({ exitCode: 0, stdout: "x", stderr: "", combined: "x" }, null), true);
  assert.equal(gatePassed({ exitCode: 0, stdout: "x", stderr: "", combined: "x" }, "y"), false);
  assert.equal(gatePassed({ exitCode: 0, stdout: "ok", stderr: "", combined: "ok" }, "ok"), true);
});


test("verifyTraceRows: missing WORKER_LOG", () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "og-trace-miss-")), "nope.md");
  const result = verifyTraceRows(p, [
    { dodId: "1", traceQuote: "x", anchor: "1", status: "PASS" as const },
  ]);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0]!.reason, /WORKER_LOG missing/);
});


test("verifyTraceRows: numeric anchor out of range", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-trace-range-"));
  const p = path.join(dir, "WORKER_LOG.md");
  fs.writeFileSync(p, "one line only\n", "utf8");
  const row = { dodId: "1", traceQuote: "one line only", anchor: "9", status: "PASS" as const };
  const strict = verifyTraceRows(p, [row], { strictTrace: true });
  assert.ok(strict.failures.length > 0);
  assert.match(strict.failures[0]!.reason, /out of range/);
  const auto = verifyTraceRows(p, [row]);
  assert.equal(auto.failures.length, 0);
  assert.equal(auto.warnings.length, 1);
  assert.equal(auto.warnings[0]!.foundLine, 1);
  assert.equal(auto.warnings[0]!.autoResolved, true);
});


test("verifyTraceRows: freeform anchor same line as quote", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-trace-free-"));
  const p = path.join(dir, "WORKER_LOG.md");
  fs.writeFileSync(p, "prefix | evidence | suffix\n", "utf8");
  const result = verifyTraceRows(p, [
    { dodId: "1", traceQuote: "evidence", anchor: "|", status: "PASS" as const },
  ]);
  assert.equal(result.failures.length, 0);
});


test("parseOptionalTimeoutMs: rejects junk", () => {
  const okNum = parseOptionalTimeoutMs("12");
  assert.ok(okNum.ok && okNum.ms === 12);
  const bad = parseOptionalTimeoutMs("nope");
  assert.equal(bad.ok, false);
});


test("verifyTraceRows: auto-fuzzy resolves line drift by default", () => {
  const lines = ["", "", "", "", "", "example trace line for gapman verify"];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "og-trace-fuzzy-"));
  const p = path.join(dir, "WORKER_LOG.md");
  fs.writeFileSync(p, `${lines.join("\n")}\n`, "utf8");
  const row = {
    dodId: "1",
    traceQuote: "example trace line for gapman verify",
    anchor: "1",
    status: "PASS" as const,
  };
  const strictOnly = verifyTraceRows(p, [row], { strictTrace: true });
  assert.ok(strictOnly.failures.length > 0);
  const auto = verifyTraceRows(p, [row]);
  assert.equal(auto.failures.length, 0);
  assert.equal(auto.warnings.length, 1);
  assert.equal(auto.warnings[0]!.foundLine, 6);
  assert.equal(auto.warnings[0]!.autoResolved, true);
});

