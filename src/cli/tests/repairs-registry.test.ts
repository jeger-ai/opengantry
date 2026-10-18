import test from "node:test";
import assert from "node:assert/strict";
import { GXT_ERROR } from "#core/error-codes.js";
import type { GateFailure, VerifyPhaseFailure } from "../lib/verify/verify-failure.js";
import {
  getRepairForErrorCode,
  resolveRepairErrorCode,
} from "../lib/repairs/registry.js";

function gateFailure(output: string): GateFailure {
  return {
    ok: false,
    phase: "gate",
    message: "GATE FAILED",
    exitCode: 1,
    executorLogPath: "EXECUTOR_LOG.md",
    gateOutput: output,
  };
}

test("resolveRepairErrorCode: maps banned-import gate stderr", () => {
  const code = resolveRepairErrorCode(
    gateFailure('src/bad.ts: banned import "axios"\n'),
  );
  assert.equal(code, GXT_ERROR.BANNED_IMPORT_DETECTED);
});

test("resolveRepairErrorCode: non-gate phase returns null", () => {
  const failure: VerifyPhaseFailure = {
    ok: false,
    phase: "trace",
    message: "trace fail",
    exitCode: 1,
    executorLogPath: "EXECUTOR_LOG.md",
    traceKind: "quote_missing",
    traceReason: "trace fail",
    traceQuote: "DoD 1 MSN-0001: quote",
  };
  assert.equal(resolveRepairErrorCode(failure), null);
});

test("getRepairForErrorCode: BANNED_IMPORT_DETECTED registered", () => {
  const repair = getRepairForErrorCode(GXT_ERROR.BANNED_IMPORT_DETECTED);
  assert.ok(repair);
  assert.equal(repair!.errorCode, GXT_ERROR.BANNED_IMPORT_DETECTED);
});

test("resolveRepairErrorCode: maps import-layer gate JSON", () => {
  const json = JSON.stringify({
    schema_version: 1,
    ok: false,
    violations: [
      {
        file: "src/cli/lib/bad.ts",
        rule_id: "RULE-LIB-TO-COMMAND",
        module_specifier: "../commands/verify.js",
        bindings: ["runVerify"],
        line: 1,
        column: 1,
      },
    ],
  });
  const code = resolveRepairErrorCode(gateFailure(""));
  assert.equal(code, null);
  const withStdout = resolveRepairErrorCode(gateFailure(json));
  assert.equal(withStdout, GXT_ERROR.IMPORT_LAYER_VIOLATION);
});

test("getRepairForErrorCode: IMPORT_LAYER_VIOLATION registered", () => {
  assert.ok(getRepairForErrorCode(GXT_ERROR.IMPORT_LAYER_VIOLATION));
});
