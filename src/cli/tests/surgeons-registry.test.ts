import test from "node:test";
import assert from "node:assert/strict";
import { GXT_ERROR } from "../lib/gxt-error-codes.js";
import type { VerifyPhaseFailure } from "../lib/verify-engine.js";
import {
  getSurgeonForErrorCode,
  hasRegisteredSurgeon,
  resolveSurgeonErrorCode,
} from "../lib/surgeons/registry.js";

function gateFailure(stderr: string): VerifyPhaseFailure {
  return {
    ok: false,
    phase: "gate",
    message: "GATE FAILED",
    exitCode: 1,
    workerLogPath: "WORKER_LOG.md",
    gateStderr: stderr,
  };
}

test("resolveSurgeonErrorCode: maps banned-import gate stderr", () => {
  const code = resolveSurgeonErrorCode(
    gateFailure('src/bad.ts: banned import "axios"\n'),
  );
  assert.equal(code, GXT_ERROR.BANNED_IMPORT_DETECTED);
});

test("resolveSurgeonErrorCode: non-gate phase returns null", () => {
  const failure: VerifyPhaseFailure = {
    ok: false,
    phase: "trace",
    message: "trace fail",
    exitCode: 1,
    workerLogPath: "WORKER_LOG.md",
  };
  assert.equal(resolveSurgeonErrorCode(failure), null);
});

test("getSurgeonForErrorCode: BANNED_IMPORT_DETECTED registered", () => {
  assert.equal(hasRegisteredSurgeon(GXT_ERROR.BANNED_IMPORT_DETECTED), true);
  const surgeon = getSurgeonForErrorCode(GXT_ERROR.BANNED_IMPORT_DETECTED);
  assert.ok(surgeon);
  assert.equal(surgeon!.errorCode, GXT_ERROR.BANNED_IMPORT_DETECTED);
});

test("resolveSurgeonErrorCode: maps import-layer gate JSON", () => {
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
  const code = resolveSurgeonErrorCode(gateFailure(""));
  assert.equal(code, null);
  const withStdout = resolveSurgeonErrorCode({
    ...gateFailure(""),
    gateStdout: json,
  });
  assert.equal(withStdout, GXT_ERROR.IMPORT_LAYER_VIOLATION);
});

test("getSurgeonForErrorCode: IMPORT_LAYER_VIOLATION registered", () => {
  assert.equal(hasRegisteredSurgeon(GXT_ERROR.IMPORT_LAYER_VIOLATION), true);
});
